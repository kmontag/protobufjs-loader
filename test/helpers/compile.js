'use strict';

const MemoryFS = require('memory-fs');
const path = require('path');

// Allow testing multiple webpack versions.
const webpack = (function () {
  switch (process.env.WEBPACK_VERSION) {
    case '2':
      return require('webpack2');
    case '3':
      return require('webpack3');
    case '4':
      return require('webpack4');
    default:
      return require('webpack');
  }
})();

const fixturePath = path.resolve(__dirname, '..', 'fixtures');

// The config object needs to look slightly different depending on the
// version of webpack that we're testing with.
const isWebpack4Plus = 'version' in webpack;
const isWebpack5 =
  isWebpack4Plus && (webpack.version || '').substring(0, 2) === '5.';

/**
 * typedef { import('webpack')| import('webpack4').loader.LoaderContext | import('webpack3').loader.LoaderContext | import('webpack2').loader.LoaderContext } LoaderContext
 */

/**
 * The `inspect-loader` passes an object describing its context and
 * the arguments it received. We define a simplified version of that
 * object here. `never` sidesteps writing definitions for stuff we're
 * not using.
 *
 * @typedef {{ arguments: [string], context: import('../../index').LoaderContext, options: never }} InspectLoaderResult
 */

/** @type { (fixture: string, loaderOpts?: object, webpackOpts?: object) => Promise<InspectLoaderResult> } */
module.exports = function (fixture, loaderOpts, webpackOpts) {
  webpackOpts = webpackOpts || {};
  return new Promise(function (resolve, reject) {
    /** @type { InspectLoaderResult } */
    let inspect;

    /**
     * @type { ReturnType<typeof webpack> }
     */
    const compiler =
      // The function signatures for different webpack versions
      // aren't compatible, so the compiler thinks this call is
      // impossible. Note we should still get a runtime error if
      // the configuration schema isn't valid.
      //
      // @ts-ignore
      webpack(
        // @ts-ignore
        Object.assign(
          {
            entry: path.resolve(fixturePath, `${fixture}.proto`),
            output: {
              path: '/',
              filename: 'compiled.js',
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
                        callback: function (callbackInspect) {
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
          },
          // webpack@4 adds the `mode` configuration option, which adds some
          // additional config defaults that we want to avoid for
          // consistency.
          isWebpack4Plus ? { mode: 'none' } : {},
          // Make sure to test webpack@5 without backwards-compatibility
          // enabled. See
          // https://webpack.js.org/configuration/experiments/#experimentsbackcompat.
          isWebpack5 ? { experiments: { backCompat: false } } : {},
          webpackOpts
        )
      );

    let fs = new MemoryFS();

    // This property is missing from the typings for older webpack
    // versions, but it's supported in practice. If we drop support
    // for v4 and below, we can remove this.
    //
    // @ts-ignore
    compiler.outputFileSystem = fs;

    compiler.run(function (err, stats) {
      const problem = (function () {
        if (err) {
          return err;
        } else if (stats) {
          if (stats.hasErrors()) {
            return 'compilation error';
          } else if (stats.hasWarnings()) {
            return 'compilation warning';
          }
        }

        return undefined;
      })();
      if (problem) {
        reject(problem);
      } else {
        resolve(inspect);
      }
    });
  });
};
