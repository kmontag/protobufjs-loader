const fs = require('fs');
const { pbjs, pbts } = require('protobufjs-cli');
const protobuf = require('protobufjs');
const tmp = require('tmp');
const validateOptions = require('schema-utils').validate;

const { getOptions } = require('loader-utils');

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
 * @typedef {{ args: string[] }} PbtsOptions
 * @typedef {{
 *   paths: string[], pbjsArgs: string[],
 *   pbts: boolean | PbtsOptions,
 *   target: string,
 * }} LoaderOptions
 */

/**
 * We're supporting multiple webpack versions, so there are several
 * different possible structures for the `this` context in our loader
 * callback.
 *
 * The `never` generic in the v5 context sets the return type of
 * `getOptions`. Since we're using the deprecated `loader-utils`
 * method of fetching options, this should be fine; however, if we
 * drop support for older webpack versions, we'll want to switch to
 * using `getOptions`.
 *
 * @typedef { import('webpack').LoaderContext<never> | import('webpack4').loader.LoaderContext | import('webpack3').loader.LoaderContext | import('webpack2').loader.LoaderContext } LoaderContext
 */

/** @type { (resourcePath: string, pbtsOptions: true | PbtsOptions, compiledContent: string, callback: NonNullable<ReturnType<LoaderContext['async']>>) => any } */
const execPbts = (resourcePath, pbtsOptions, compiledContent, callback) => {
  /** @type PbtsOptions */
  const normalizedOptions = {
    args: [],
    ...(pbtsOptions === true ? {} : pbtsOptions),
  };

  // pbts CLI only supports streaming from stdin without a lot of
  // duplicated logic, so we need to use a tmp file. :(
  new Promise((resolve, reject) => {
    tmp.file({ postfix: '.js' }, (err, compiledFilename) => {
      if (err) {
        reject(err);
      } else {
        resolve(compiledFilename);
      }
    });
  })
    .then(
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
    )
    .then((compiledFilename) => {
      const declarationFilename = `${resourcePath}.d.ts`;
      const pbtsArgs = ['-o', declarationFilename]
        .concat(normalizedOptions.args)
        .concat([compiledFilename]);
      pbts.main(pbtsArgs, (err) => {
        callback(err, compiledContent);
      });
    });
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
      if ('options' in this) {
        // For webpack@2 and webpack@3. property loaderContext.options
        // was deprecated in webpack@3 and removed in webpack@4.
        return (this.options.resolve || {}).modules;
      }

      if (this._compiler) {
        // For webpack@4 and webpack@5. The `_compiler` property is
        // deprecated, but still works as of webpack@5.
        return (this._compiler.options.resolve || {}).modules;
      }

      return undefined;
    })();

    /** @type LoaderOptions */
    const options = {
      target: TARGET_STATIC_MODULE,

      // Default to the paths given to the compiler.
      paths: defaultPaths || [],

      pbjsArgs: [],

      pbts: false,

      ...getOptions(this),
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
              if (resolved !== filename) {
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
