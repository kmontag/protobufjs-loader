const path = require('path');
const webpack = require('webpack');
const { createFsFromVolume, Volume } = require('memfs');

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
module.exports = async function compile(fixture, loaderOpts, webpackOpts) {
  /** @type { InspectLoaderResult | undefined } */
  let inspect = undefined;

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

  // Create an in-memory file system for compilation, see
  // https://webpack.js.org/contribute/writing-a-loader/#testing.
  //
  // The typechecker thinks this is an incompatible assignment, but
  // it's pulled from the webpack docs.
  //
  // @ts-expect-error
  compiler.outputFileSystem = createFsFromVolume(new Volume());

  // Help the typechecker.
  if (compiler.outputFileSystem === null) {
    throw new Error('unexpected: null output file system');
  }
  compiler.outputFileSystem.join = path.join.bind(path);

  /** @type { webpack.Stats } */
  const stats = await new Promise((resolve, reject) => {
    compiler.run((err, statsResult) => {
      if (err) {
        reject(err);
      } else {
        resolve(statsResult);
      }
    });
  });

  if (stats.hasErrors()) {
    if ('compilation' in stats) {
      /** @type Error */
      const compilationErr = stats.compilation.errors[0];
      if (compilationErr) {
        throw compilationErr;
      }
    }

    // fallback in case no specific error was found above for
    // some reason.
    throw new Error('unknown compilation error');
  }
  if (stats.hasWarnings()) {
    throw new Error('compilation has warnings');
  }

  if (inspect === undefined) {
    throw new Error('unexpected - inspect loader was never invoked');
  }

  return { inspect };
};
