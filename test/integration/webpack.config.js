const path = require('path');

/**
 * Real-world webpack configuration for the integration build. Unlike
 * the unit test helper, this writes output to the actual filesystem
 * (in the gitignored `dist` directory) so the artifacts can be
 * executed and inspected.
 *
 * @type { import('webpack').Configuration }
 */
module.exports = {
  entry: path.resolve(__dirname, 'entry.js'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'main.js',
  },
  target: 'node',
  mode: 'none',
  module: {
    rules: [
      {
        test: /\.proto$/,
        use: {
          loader: path.resolve(__dirname, '..', '..', 'index.js'),
          options: {
            pbts: {
              /** @type { (resourcePath: string) => string } */
              output: (resourcePath) =>
                path.join(
                  __dirname,
                  'dist',
                  `${path.basename(resourcePath)}.d.ts`,
                ),
            },
          },
        },
      },
    ],
  },
};
