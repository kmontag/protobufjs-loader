[![npm](https://img.shields.io/npm/v/protobufjs-loader)](https://www.npmjs.com/package/protobufjs-loader)
[![Test & Publish](https://github.com/kmontag/protobufjs-loader/actions/workflows/release.yml/badge.svg)](https://github.com/kmontag/protobufjs-loader/actions/workflows/release.yml)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

# protobufjs-loader

Webpack loader to translate
[protobuf](https://github.com/google/protobuf/) definitions to
[protobuf.js](https://github.com/protobufjs/protobuf.js)
modules. Equivalent to running your definitions through the [pbjs
CLI](https://github.com/protobufjs/protobuf.js/tree/master/cli).

This allows you to use the light or minimal protobuf.js distributions
without an explicit compile step in your build pipeline.

# Installation

```sh
npm install --save-dev protobufjs-loader
```

# Usage

```javascript
// webpack.config.js

module.exports = {
  // ...
  module: {
    rules: [
      {
        test: /\.proto$/,
        use: {
          loader: 'protobufjs-loader',
          options: {
            /* Import paths provided to pbjs.
             *
             * default: webpack import paths (i.e. config.resolve.modules)
             */
            paths: ['/path/to/definitions'],

            /* Additional command line arguments passed to pbjs.
             *
             * default: []
             */
            pbjsArgs: ['--no-encode'],

            /* Enable Typescript declaration file generation via pbts.
             *
             * Declaration files will be written every time the loader runs.
             * They'll be saved in the same directory as the protobuf file
             * being processed, with a `.d.ts` extension.
             *
             * This only works if you're using the 'static-module' target
             * for pbjs (i.e. the default target).
             *
             * The value here can be a config object or a boolean; set it to
             * true to enable pbts with default configuration.
             *
             * default: false
             */
            pbts: {
              /* Additional command line arguments passed to pbts.
               */
              args: ['--no-comments'],
            },

            /* Set the "target" flag to pbjs.
             *
             * default: 'static-module'
             */
            target: 'json-module',
          },
        },
      },
    ],
  },
};
```

```javascript
// myModule.js

/* replaces e.g.:
 *
 *   const protobuf = require('protobufjs/light');
 *   const jsonDescriptor = require('json!my/compiled/protobuf.js');
 *   const Root = protobuf.Root.fromJSON(jsonDescriptor);
 */
const Root = require('my/protobuf.proto');
```
