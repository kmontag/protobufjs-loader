const fs = require('fs');
const { pbjs, pbts } = require('protobufjs-cli');
const protobuf = require('protobufjs');
const tmp = require('tmp');
const validateOptions = require('schema-utils').validate;

const TARGET_STATIC_MODULE = 'static-module';

/** @type { Parameters<typeof validateOptions>[0] } */
const schema = {
  type: 'object',
  properties: {
    target: {
      type: 'string',
      default: TARGET_STATIC_MODULE,
    },
    paths: {
      type: 'array',
    },
    pbjsArgs: {
      type: 'array',
      default: [],
    },
    pbts: {
      oneOf: [
        {
          type: 'boolean',
        },
        {
          type: 'object',
          properties: {
            args: {
              type: 'array',
              default: [],
            },
            output: {
              anyOf: [{ type: 'null' }, { instanceof: 'Function' }],
              default: null,
            },
          },
          additionalProperties: false,
        },
      ],
      default: false,
    },
  },

  additionalProperties: false,
};

/**
 * Shared type for the validated options object, with no missing
 * properties (i.e. the user-provided object merged with default
 * values).
 *
 * @typedef {{ args: string[], output: ((resourcePath: string) => string | Promise<string>) | null }} PbtsOptions
 * @typedef {{
 *   paths: string[], pbjsArgs: string[],
 *   pbts: boolean | PbtsOptions,
 *   target: string,
 * }} LoaderOptions
 */

/**
 * The generic parameter is the type of the options object in the
 * configuration. All `LoaderOptions` fields are optional at this
 * stage.
 *
 * @typedef { import('webpack').LoaderContext<Partial<LoaderOptions>> } LoaderContext
 */

/** @type { (resourcePath: string, pbtsOptions: true | PbtsOptions, compiledContent: string, callback: NonNullable<ReturnType<LoaderContext['async']>>) => any } */
const execPbts = (resourcePath, pbtsOptions, compiledContent, callback) => {
  try {
    /** @type PbtsOptions */
    const normalizedOptions = {
      args: [],
      output: null,
      ...(pbtsOptions === true ? {} : pbtsOptions),
    };

    // pbts CLI only supports streaming from stdin without a lot of
    // duplicated logic, so we need to use a tmp file. :(
    /** @type Promise<string> */
    const compiledFilenamePromise = new Promise((resolve, reject) => {
      tmp.file({ postfix: '.js' }, (err, compiledFilename) => {
        if (err) {
          reject(err);
        } else {
          resolve(compiledFilename);
        }
      });
    }).then(
      (compiledFilename) =>
        new Promise((resolve, reject) => {
          fs.writeFile(compiledFilename, compiledContent, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve(compiledFilename);
            }
          });
        })
    );
    /** @type { (resourcePath: string) => string | Promise<string> } */
    const output =
      normalizedOptions.output === null
        ? (r) => `${r}.d.ts`
        : normalizedOptions.output;
    const declarationFilenamePromise = Promise.resolve(output(resourcePath));

    Promise.all([compiledFilenamePromise, declarationFilenamePromise])
      .then(([compiledFilename, declarationFilename]) => {
        const pbtsArgs = ['-o', declarationFilename]
          .concat(normalizedOptions.args)
          .concat([compiledFilename]);
        pbts.main(pbtsArgs, (err) => {
          callback(err, compiledContent);
        });
      })
      .catch((err) => {
        callback(err, undefined);
      });
  } catch (err) {
    callback(err instanceof Error ? err : new Error(`${err}`), undefined);
  }
};

/** @type { (this: LoaderContext, source: string) => any } */
module.exports = function protobufJsLoader(source) {
  const callback = this.async();
  const self = this;

  // Explicitly check this case, as the typescript compiler thinks
  // it's possible.
  if (callback === undefined) {
    throw new Error('Failed to request async execution from webpack');
  }

  try {
    const defaultPaths = (() => {
      if (this._compiler) {
        // The `_compiler` property is deprecated, but still works as
        // of webpack@5.
        return (this._compiler.options.resolve || {}).modules;
      }

      return undefined;
    })();

    /** @type LoaderOptions */
    const options = {
      target: TARGET_STATIC_MODULE,
      // Default to the module search paths given to the compiler.
      paths: defaultPaths || [],
      pbjsArgs: [],
      pbts: false,
      ...this.getOptions(),
    };
    validateOptions(schema, options, { name: 'protobufjs-loader' });

    /** @type { string } */
    new Promise((resolve, reject) => {
      tmp.file((err, filename) => {
        if (err) {
          reject(err);
        } else {
          resolve(filename);
        }
      });
    })
      .then(
        (filename) =>
          new Promise((resolve, reject) => {
            fs.writeFile(filename, source, (err) => {
              if (err) {
                reject(err);
              } else {
                resolve(filename);
              }
            });
          })
      )
      .then((filename) => {
        const { paths } = options;

        const loadDependencies = new Promise((resolve, reject) => {
          const root = new protobuf.Root();
          root.resolvePath = (origin, target) => {
            // Adapted from
            // https://github.com/dcodeIO/protobuf.js/blob/master/cli/pbjs.js
            const normOrigin = protobuf.util.path.normalize(origin);
            const normTarget = protobuf.util.path.normalize(target);

            let resolved = protobuf.util.path.resolve(
              normOrigin,
              normTarget,
              true
            );
            const idx = resolved.lastIndexOf('google/protobuf/');
            if (idx > -1) {
              const altname = resolved.substring(idx);
              if (altname in protobuf.common) {
                resolved = altname;
              }
            }

            if (fs.existsSync(resolved)) {
              // Don't add a dependency on the temp file
              if (resolved !== protobuf.util.path.normalize(filename)) {
                self.addDependency(resolved);
              }
              return resolved;
            }

            for (let i = 0; i < paths.length; i += 1) {
              const iresolved = protobuf.util.path.resolve(
                `${paths[i]}/`,
                target
              );
              if (fs.existsSync(iresolved)) {
                self.addDependency(iresolved);
                return iresolved;
              }
            }

            return null;
          };
          protobuf.load(filename, root, (err, result) => {
            if (err) {
              reject(err);
            } else {
              resolve(result);
            }
          });
        });

        /** @type { string[] } */
        let args = ['-t', options.target];
        paths.forEach((path) => {
          args = args.concat(['-p', path]);
        });
        args = args.concat(options.pbjsArgs).concat([filename]);

        pbjs.main(args, (err, result) => {
          // Make sure we've added all dependencies before completing.
          loadDependencies
            .catch((depErr) => {
              callback(depErr);
            })
            .then(() => {
              if (!options.pbts || err) {
                callback(err, result);
              } else {
                execPbts(
                  self.resourcePath,
                  options.pbts,
                  result || '',
                  callback
                );
              }
            });
        });
      })
      .catch((err) => {
        callback(err instanceof Error ? err : new Error(`${err}`), undefined);
      });
  } catch (err) {
    callback(err instanceof Error ? err : new Error(`${err}`), undefined);
  }
};
