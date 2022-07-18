'use strict';

const fs = require('fs');
const pbjs = require('protobufjs/cli').pbjs;
const protobuf = require('protobufjs');
const tmp = require('tmp-promise');
const validateOptions = require('schema-utils').validate;

const getOptions = require('loader-utils').getOptions;

/** @type { Parameters<typeof validateOptions>[0] } */
const schema = {
  type: 'object',
  properties: {
    json: {
      type: 'boolean',
    },
    paths: {
      type: 'array',
    },
    pbjsArgs: {
      type: 'array',
    },
  },
  additionalProperties: false,
};

/**
 * We're supporting multiple webpack versions, so there are several
 * different possible structures for the `this` context in our loader
 * callback.
 *
 * @typedef { import('webpack').LoaderContext<never> | import('webpack4').loader.LoaderContext | import('webpack3').loader.LoaderContext } LoaderContext
 */

/** @type { (this: LoaderContext, source: string) => any } */
module.exports = function (source) {
  let callback = this.async();
  let self = this;

  const paths =
    'options' in this
      ? // For webpack@2 and webpack@3. property loaderContext.options
        // was deprecated in webpack@3 and removed in webpack@4.
        (this.options.resolve || {}).modules
      : // For webpack@4 and webpack@5. The `_compiler` property is
        // deprecated, but still works as of webpack@5.
        (this._compiler.options.resolve || {}).modules;

  const options = Object.assign(
    {
      json: false,

      // Default to the paths given to the compiler.
      paths: paths || [],

      pbjsArgs: [],
    },
    getOptions(this)
  );
  validateOptions(schema, options, { name: 'protobufjs-loader' });

  let filename;
  tmp
    .file()
    .then(function (o) {
      filename = o.path;
      return new Promise(function (resolve, reject) {
        fs.write(o.fd, source, function (err, bytesWritten, _buffer) {
          if (err) {
            reject(err);
          } else {
            resolve(bytesWritten);
          }
        });
      });
    })
    .then(function () {
      let paths = options.paths;

      let loadDependencies = new Promise(function (resolve, reject) {
        let root = new protobuf.Root();
        root.resolvePath = function (origin, target) {
          // Adapted from
          // https://github.com/dcodeIO/protobuf.js/blob/master/cli/pbjs.js
          var normOrigin = protobuf.util.path.normalize(origin),
            normTarget = protobuf.util.path.normalize(target);

          var resolved = protobuf.util.path.resolve(
            normOrigin,
            normTarget,
            true
          );
          var idx = resolved.lastIndexOf('google/protobuf/');
          if (idx > -1) {
            var altname = resolved.substring(idx);
            if (altname in protobuf.common) {
              resolved = altname;
            }
          }

          if (fs.existsSync(resolved)) {
            // Don't add a dependency on the temp file
            if (resolved !== filename) {
              self.addDependency(resolved);
            }
            return resolved;
          }

          for (var i = 0; i < paths.length; ++i) {
            var iresolved = protobuf.util.path.resolve(paths[i] + '/', target);
            if (fs.existsSync(iresolved)) {
              self.addDependency(iresolved);
              return iresolved;
            }
          }
        };
        protobuf.load(filename, root, function (err, result) {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        });
      });

      let args = options.pbjsArgs;
      paths.forEach(function (path) {
        args = args.concat(['-p', path]);
      });
      args = args
        .concat(['-t', options.json ? 'json-module' : 'static-module'])
        .concat([filename]);

      pbjs.main(args, function (err, result) {
        // Make sure we've added all dependencies before completing.
        loadDependencies
          .catch(function (depErr) {
            callback(depErr);
          })
          .then(function () {
            callback(err, result);
          });
      });
    });
};
