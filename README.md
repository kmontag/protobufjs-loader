[![Test & Publish](https://github.com/kmontag/protobufjs-loader/actions/workflows/release.yml/badge.svg)](https://github.com/kmontag/protobufjs-loader/actions/workflows/release.yml)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release) 

# protobufjs-loader
Webpack loader to translate
[protobuf](https://github.com/google/protobuf/) definitions to
[ProtoBuf.js](https://github.com/dcodeIO/ProtoBuf.js/)
modules. Equivalent to running your definitions through the [pbjs
CLI](https://github.com/dcodeIO/ProtoBuf.js/#pbjs-for-javascript).

This allows you to use the light or minimal ProtoBuf.js distributions
without an explicit compile step in your build pipeline.

# Install

``` sh
npm install --save-dev protobufjs-loader
```

# Usage

``` javascript
// webpack.config.js

module.exports = {
    ...
    module: {
        rules: [{
            test: /\.proto$/,
            use: {
              loader: 'protobufjs-loader',
              options: {
                /* controls the "target" flag to pbjs - true for
                 * json-module, false for static-module.
                 * default: false
                 */
                json: true,
                
                /* import paths provided to pbjs.
                 * default: webpack import paths (i.e. config.resolve.modules)
                 */
                paths: ['/path/to/definitions'],
                
                /* additional command line arguments passed to
                 * pbjs, see https://github.com/dcodeIO/ProtoBuf.js/#pbjs-for-javascript
                 * for a list of what's available.
                 * default: []
                 */
                pbjsArgs: ['--no-encode']
              }
            }
        }]
    }
};
```

``` javascript
// myModule.js

/* replaces e.g.:
 * 
 *   const protobuf = require('protobufjs/light');
 *   const jsonDescriptor = require('json!my/compiled/protobuf.js');
 *   const Root = protobuf.Root.fromJSON(jsonDescriptor);
 */
const Root = require('my/protobuf.proto');

```
