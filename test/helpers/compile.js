'use strict';

const MemoryFS = require('memory-fs');
const path = require('path');

// Allow testing multiple webpack versions.
const webpack = (function () {
  switch (process.env.WEBPACK_VERSION) {
    case '2':
      return require('webpack2');
      break;
    case '3':
      return require('webpack3');
      break;
    case '4':
      return require('webpack4');
      break;
    default:
      return require('webpack');
      break;
  }
})();

const fixturePath = path.resolve(__dirname, '..', 'fixtures');

// The config object needs to look slightly different depending on the
// version of webpack that we're testing with.
const isWebpack4Plus = 'version' in webpack;
const isWebpack5 = isWebpack4Plus && webpack.version.substring(0, 2) === '5.';

module.exports = function (fixture, loaderOpts, webpackOpts) {
  webpackOpts = webpackOpts || {};
  return new Promise(function (resolve, reject) {
    let inspect;
    const compiler = webpack(
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
                      callback: function (_inspect) {
                        inspect = _inspect;
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
    compiler.outputFileSystem = fs;
    compiler.run(function (err, stats) {
      const problem =
        err || stats.compilation.errors[0] || stats.compilation.warnings[0];
      if (problem) {
        reject(problem);
      } else {
        resolve(inspect);
      }
    });
  });
};
