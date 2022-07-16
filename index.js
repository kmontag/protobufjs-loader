"use strict";

const fs = require('fs');
const path = require('path');
const pbjsCLI = require('protobufjs/cli');
const pbjs = pbjsCLI.pbjs;
const pbts = pbjsCLI.pbts;
const protobuf = require('protobufjs');
const tmp = require('tmp-promise');
const validateOptions = require('schema-utils');

const getOptions = require('loader-utils').getOptions;

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
    pbts: {
      type: 'boolean'
    }
  },
  additionalProperties: false,
};

module.exports = function(source) {
  let callback = this.async();
  let self = this;

  const paths = this.options ? // for webpack@2 and webpack@3
    // property loaderContext.options has been
    // deprecated in webpack@3 and removed in webpack@4
    (this.options.resolve || {}).modules
    // for webpack@4
    // but property this._compiler deprecated in webpack@3 too
    : (this._compiler.options.resolve || {}).modules;

  const options = Object.assign({
    json: false,

    // Default to the paths given to the compiler
    paths: paths || [],

    pbjsArgs: [],

    pbts: false,
  }, getOptions(this));
  validateOptions(schema, options, 'protobufjs-loader');

  let filename;
  tmp.file().then(function(o) {
    filename = o.path;
    return new Promise(function(resolve, reject) {
      fs.write(o.fd, source, function(err, bytesWritten, buffer) {
        if (err) {
          reject(err);
        } else {
          resolve(bytesWritten, buffer);
        }
      });
    });
  }).then(function() {
    let paths = options.paths;

    let loadDependencies = new Promise(function(resolve, reject) {
      let root = new protobuf.Root();
      root.resolvePath = function(origin, target) {
        // Adapted from
        // https://github.com/dcodeIO/protobuf.js/blob/master/cli/pbjs.js
        var normOrigin = protobuf.util.path.normalize(origin),
            normTarget = protobuf.util.path.normalize(target);

        var resolved = protobuf.util.path.resolve(normOrigin, normTarget, true);
        var idx = resolved.lastIndexOf("google/protobuf/");
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
          var iresolved = protobuf.util.path.resolve(paths[i] + "/", target);
          if (fs.existsSync(iresolved)) {
            self.addDependency(iresolved);
            return iresolved;
          }
        }
      };
      protobuf.load(filename, root, function(err, result) {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });

    let args = options.pbjsArgs;
    paths.forEach(function(path) {
      args = args.concat(['-p', path]);
    });
    args = args.concat([
      '-t',
      options.json ? 'json-module' : 'static-module',
    ]).concat([filename]);

    pbjs.main(args, function(err, result) {
      // Make sure we've added all dependencies before completing.
      loadDependencies.catch(function(depErr) {
        callback(depErr);
      }).then(function() {
        if(!options.pbts || err) {
          callback(err, result);
        } else {
          execPBTS(self.resourcePath, result, callback);
        }
      });
    });
  });
};

function execPBTS(resourcePath, compiledContent, callback) {
  // pbts CLI only supports streaming from stdin without a lot of duplicated logic, so we need to use a tmp file. :(
  tmp.file({postfix: ".js"}).then(function(o) {
    return new Promise(function(resolve, reject) {
      fs.write(o.fd, compiledContent, function(err, bytesWritten, buffer) {
        if (err) {
          reject(err);
        } else {
          resolve(o.path);
        }
      });
    });
  }).then(function(compiledFilename) {
    let declarationFilename = resourcePath + ".d.ts";
    let pbtsArgs = ["-o", declarationFilename, compiledFilename];
    pbts.main(pbtsArgs, function(err, declarationContent) {
      callback(err, compiledContent);
    });
  });
}
