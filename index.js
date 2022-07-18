const fs = require('fs');
const { pbjs, pbts } = require('protobufjs/cli');
const protobuf = require('protobufjs');
const tmp = require('tmp-promise');
const validateOptions = require('schema-utils').validate;

const { getOptions } = require('loader-utils');

/** @type { Parameters<typeof validateOptions>[0] } */
const schema = {
  type: 'object',
  properties: {
    json: {
      type: 'boolean',
      default: false,
    },
    paths: {
      type: 'array',
    },
    pbjsArgs: {
      type: 'array',
      default: [],
    },
    pbts: {
      type: 'boolean',
      default: false,
    },
  },

  // pbts config is only applicable if the pbjs target is
  // `static-module`, i.e. if the `json` flag is false. We enforce
  // this at the schema level; see
  // https://json-schema.org/understanding-json-schema/reference/conditionals.html#implication.
  anyOf: [
    {
      properties: {
        json: { const: true },
        pbts: { const: false },
      },
    },
    {
      not: {
        properties: { json: { const: true } },
      },
    },
  ],
  additionalProperties: false,
};

/**
 * We're supporting multiple webpack versions, so there are several
 * different possible structures for the `this` context in our loader
 * callback.
 *
 * The `never` generic in the v5 context sets the return type of
 * `getOptions`. Since we're using the deprecated `loader-utils`
 * method of fetching options, this should be fine; however, if we
 * drop support for older webpack versions, we'll want to define a
 * stricter type for the options object.
 *
 * @typedef { import('webpack').LoaderContext<never> | import('webpack4').loader.LoaderContext | import('webpack3').loader.LoaderContext | import('webpack2').loader.LoaderContext } LoaderContext
 */

/** @type { (resourcePath: string, compiledContent: string, callback: NonNullable<ReturnType<LoaderContext['async']>>) => any } */
const execPbts = (resourcePath, compiledContent, callback) => {
  // pbts CLI only supports streaming from stdin without a lot of
  // duplicated logic, so we need to use a tmp file. :(
  tmp
    .file({ postfix: '.js' })
    .then(
      (o) =>
        new Promise((resolve, reject) => {
          fs.write(o.fd, compiledContent, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve(o.path);
            }
          });
        })
    )
    .then((compiledFilename) => {
      const declarationFilename = `${resourcePath}.d.ts`;
      const pbtsArgs = ['-o', declarationFilename, compiledFilename];
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

  /** @type {{ json: boolean, paths: string[], pbjsArgs: string[], pbts: boolean }} */
  const options = {
    json: false,

    // Default to the paths given to the compiler.
    paths: defaultPaths || [],

    pbjsArgs: [],

    pbts: false,

    ...getOptions(this),
  };
  try {
    validateOptions(schema, options, { name: 'protobufjs-loader' });
  } catch (err) {
    callback(err instanceof Error ? err : new Error('' + err), undefined);
    return;
  }

  /** @type { string } */
  let filename;
  tmp
    .file()
    .then((o) => {
      filename = o.path;
      return new Promise((resolve, reject) => {
        fs.write(o.fd, source, (err, bytesWritten) => {
          if (err) {
            reject(err);
          } else {
            resolve(bytesWritten);
          }
        });
      });
    })
    .then(() => {
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

      let args = options.pbjsArgs;
      paths.forEach((path) => {
        args = args.concat(['-p', path]);
      });
      args = args
        .concat(['-t', options.json ? 'json-module' : 'static-module'])
        .concat([filename]);

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
              execPbts(self.resourcePath, result || '', callback);
            }
          });
      });
    });
};
