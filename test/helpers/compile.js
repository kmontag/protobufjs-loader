const MemoryFS = require('memory-fs');
const path = require('path');
const webpack = require('webpack');

const fixturePath = path.resolve(__dirname, '..', 'fixtures');

/**
 * The `inspect-loader` passes an object describing its context and
 * the arguments it received. We define a simplified version of that
 * object here. `never` sidesteps writing definitions for stuff we're
 * not using.
 *
 * @typedef {{ arguments: [string], context: import('../../index').LoaderContext, options: never }} InspectLoaderResult
 */

/**
 * @typedef { import('webpack').Configuration } WebpackConfig
 */

/**
 * @type { (fixture: string, loaderOpts?: object, webpackOpts?: object) => Promise<{ inspect: InspectLoaderResult }> }
 */
module.exports = function compile(fixture, loaderOpts, webpackOpts) {
  return new Promise((resolve, reject) => {
    /** @type { InspectLoaderResult } */
    let inspect;

    /** @type { WebpackConfig } */
    const config = {
      entry: path.resolve(fixturePath, `${fixture}.proto`),
      output: {
        path: '/',
        filename: 'compiled.js',
        // By default, webpack@4+ uses a hash function (md4) which is
        // not supported by the Node 17+ SSL provider. Set it
        // explicitly to avoid a compilation error unrelated to
        // protobufjs. See
        // https://stackoverflow.com/a/73465262/13264260.
        hashFunction: 'md5',
      },
      module: {
        rules: [
          {
            test: /\.proto$/,
            use: [
              {
                loader: 'inspect-loader',
                options: {
                  /** @type { (inspect: InspectLoaderResult) => any } */
                  callback(callbackInspect) {
                    inspect = callbackInspect;
                  },
                },
              },
              {
                loader: path.resolve(__dirname, '..', '..', 'index.js'),
                options: loaderOpts,
              },
            ],
          },
        ],
      },
      // webpack@4 adds the `mode` configuration option, which adds some
      // additional config defaults that we want to avoid for
      // consistency.
      mode: 'none',
      // Make sure to test without backwards-compatibility
      // enabled. See
      // https://webpack.js.org/configuration/experiments/#experimentsbackcompat.
      experiments: { backCompat: false },
      ...webpackOpts,
    };

    const compiler = webpack(config);
    const fs = new MemoryFS();

    // This property is missing from the typings for older webpack
    // versions, but it's supported in practice. If we drop support
    // for v4 and below, we can remove this.
    //
    // @ts-ignore
    compiler.outputFileSystem = fs;

    compiler.run((err, stats) => {
      const problem = (() => {
        if (err) {
          return err;
        }
        if (stats) {
          if (stats.hasErrors()) {
            if ('compilation' in stats) {
              /** @type Error */
              // The `stats` object appears to be incorrectly typed;
              // this compilation field exists in practice.
              //
              // @ts-ignore
              const compilationErr = stats.compilation.errors[0];
              if (compilationErr) {
                return compilationErr;
              }
            }

            // fallback in case no specific error was found above for
            // some reason.
            return 'compilation error';
          }
          if (stats.hasWarnings()) {
            return 'compilation warning';
          }
        }

        return undefined;
      })();

      if (problem) {
        reject(problem);
      } else {
        resolve({
          inspect,
        });
      }
    });
  });
};
