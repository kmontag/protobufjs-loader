"use strict";

const MemoryFS = require('memory-fs');
const path = require('path');

// Allow testing multiple webpack versions.
const webpack = (function() {
  switch (process.env.WEBPACK_VERSION) {
    case '2':
      return require('webpack2');
      break;
    case '3':
      return require('webpack3');
      break;
    default:
      return require('webpack');
      break;
  }
})();

const fixturePath = path.resolve(__dirname, '..', 'fixtures');

// The config
const isWebpack4Plus = ('version' in webpack);

module.exports = function (fixture, loaderOpts, webpackOpts) {
  webpackOpts = (webpackOpts || {});
  return new Promise(function(resolve, reject) {
    let inspect;
    const compiler = webpack(Object.assign({
      entry: path.resolve(fixturePath, `${fixture}.proto`),
      output: {
        path: '/',
        filename: 'compiled.js',
      },
      module: {
        rules: [{
          test: /\.proto$/,
          use: [{
            loader: 'inspect-loader',
            options: {
              callback: function(_inspect) {
                inspect = _inspect;
              }
            }
          }, {
            loader: 'uglify-loader',
            options: {
              mangle: false,
            },
          }, {
            loader: path.resolve(__dirname, '..', '..', 'index.js'),
            options: loaderOpts,
          }]
        }],
      }
    }, isWebpack4Plus ? { mode: 'none' } : {}, webpackOpts));

    let fs = new MemoryFS();
    compiler.outputFileSystem = fs;
    compiler.run(function(err, stats) {
      const problem = err || stats.compilation.errors[0] || stats.compilation.warnings[0];
      if (problem) {
        reject(problem);
      } else {
        resolve(inspect);
      }
    });
  });
}
