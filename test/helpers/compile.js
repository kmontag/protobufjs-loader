"use strict";

const MemoryFS = require('memory-fs');
const path = require('path');
const webpack = require('webpack');
const semver = require('semver');

const fixturePath = path.resolve(__dirname, '..', 'fixtures');
console.log(webpack.version);

module.exports = function (fixture, loaderOpts, webpackOpts) {
  webpackOpts = (webpackOpts || {});
  return new Promise(function(resolve, reject) {
    let inspect;
    const webpackOptions = Object.assign({
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
    }, webpackOpts);

    if (webpack.version && semver.gt(webpack.version, '4.0.0')) {
      webpackOptions.mode = 'production';
    }
    const compiler = webpack(webpackOptions);

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
