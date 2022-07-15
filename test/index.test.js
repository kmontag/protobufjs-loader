"use strict";

const assert = require('chai').assert;
const path = require('path');
const protobuf = require('protobufjs');

const compile = require('./helpers/compile');

before(function(done) {
  // The first time the compiler gets run (e.g. in a CI environment),
  // some additional packages will be installed in the
  // background. This can take awhile and trigger a timeout, so we do
  // it here explicitly first.
  this.timeout(10000);
  compile('basic').then(function(inspect) {
    done();
  });
});

describe('with JSON / reflection', function() {
  beforeEach(function() {
    this.opts = {
      json: true,
    };
  });
  it('should compile to a JSON representation', function(done) {
    compile('basic', this.opts).then(function(inspect) {
      let contents = inspect.arguments[0];
      let innerString = 'addJSON({foo:{nested:{Bar:{fields:{baz:{type:"string",id:1}}}}}})})'
      assert.include(contents, innerString);
      done();
    });
  });
});

describe('with static code', function() {
  it('should compile static code by default', function(done) {
    compile('basic').then(function(inspect) {
      let contents = inspect.arguments[0];
      assert.include(contents, 'foo.Bar=function(){');
      done();
    });
  });

  it('should compile static code when the option is set explicitly', function(done) {
    compile('basic', {json: false}).then(function(inspect) {
      let contents = inspect.arguments[0];
      assert.include(contents, 'foo.Bar=function(){');
      done();
    });
  });
});

describe('with command line options', function() {
  it('should pass command line options to the pbjs call', function(done) {
    compile('basic', {pbjsArgs: ['--no-encode']}).then(function(inspect) {
      let contents = inspect.arguments[0];
      // Sanity check
      let innerString = 'Bar.decode=function(reader,length)';
      assert.include(contents, innerString);

      assert.notInclude(contents, 'encode');
      done();
    });
  });
});

describe('with imports', function() {
  beforeEach(function() {
    this.innerString = 'addJSON({foo:{nested:{NotBar:{fields:{bar:{type:"Bar",id:1}}},Bar:{fields:{baz:{type:"string",id:1}}}}}})})';
  });

  it('should respect the webpack paths configuration in webpack@2 and webpack@3', function(done) {
    let innerString = this.innerString;
    compile('import', {
      json: true,
    }, {
      resolve: {
        modules: ['node_modules', path.resolve(__dirname, 'fixtures')],
      }
    }).then(function(inspect) {
      let contents = inspect.arguments[0];
      assert.include(contents, innerString);
      done();
    });
  });

  it('should respect an explicit paths configuration', function(done) {
    let innerString = this.innerString;
    compile('import', {
      json: true,
      paths: [path.resolve(__dirname, 'fixtures')],
    }).then(function(inspect) {
      let contents = inspect.arguments[0];
      assert.include(contents, innerString);
      done();
    });
  });

  it('should add the imports as dependencies', function(done) {
    compile('import', {paths: [path.resolve(__dirname, 'fixtures')]}).then(function(inspect) {
      const normalizedImportedPath = protobuf.util.path.normalize(path.resolve(__dirname, 'fixtures', 'basic.proto'));
      assert.include(inspect.context.getDependencies(), normalizedImportedPath);
      done();
    });
  });

  it('should fail when the import is not found', function(done) {
    compile('import', {
      json: true,
      // No include paths provided, so the 'import' fixture should
      // fail to compile.
    }).catch((err) => {
      // Nothing to assert, we're just testing that the error happened.
      done();
    });
  });
});
