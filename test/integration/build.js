/**
 * Runs the integration build. Standalone so the build can also be
 * performed by hand:
 *
 *   node test/integration/build.js
 *   node test/integration/dist/main.js
 */
const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

const config = require('./webpack.config');

// The loader writes the pbts declaration file into the output
// directory before webpack creates it, so ensure it exists.
fs.mkdirSync(path.resolve(__dirname, 'dist'), { recursive: true });

webpack(config, (err, stats) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  if (stats === undefined) {
    throw new Error('unexpected - no compilation stats');
  }
  console.log(stats.toString({ colors: false }));
  process.exit(stats.hasErrors() ? 1 : 0);
});
