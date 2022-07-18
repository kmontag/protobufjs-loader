const { assert } = require('chai');
const path = require('path');
const UglifyJS = require('uglify-js');

const compile = require('./helpers/compile');

/**
 * Minifies the given JS string using ugilfy-js, so we can
 * consistently compare generated outputs using relatively compact
 * strings.
 *
 * @type { (contents: string) => string }
 */
const minify = (contents) => {
  const result = UglifyJS.minify(contents, {
    compress: {
      // This avoids some larger structural changes in the minified
      // code during compression.
      inline: false,
    },

    // Don't mangle function/variable names.
    mangle: false,

    // Don't remove names of functions which aren't referenced by name
    // somewhere.
    keep_fnames: true,
  });
  if (result.error) {
    throw result.error;
  }
  return result.code;
};

describe('protobufjs-loader', function () {
  before(function (done) {
    // The first time the compiler gets run (e.g. in a CI environment),
    // some additional packages will be installed in the
    // background. This can take awhile and trigger a timeout, so we do
    // it here explicitly first.
    this.timeout(10000);
    compile('basic').then(() => {
      done();
    });
  });

  describe('with JSON / reflection', function () {
    beforeEach(function () {
      this.opts = {
        json: true,
      };
    });
    it('should compile to a JSON representation', function (done) {
      compile('basic', this.opts).then(({ inspect }) => {
        const contents = minify(inspect.arguments[0]);
        const innerString =
          'addJSON({foo:{nested:{Bar:{fields:{baz:{type:"string",id:1}}}}}})})';
        assert.include(contents, innerString);
        done();
      });
    });
  });

  describe('with static code', function () {
    it('should compile static code by default', function (done) {
      compile('basic').then(({ inspect }) => {
        const contents = minify(inspect.arguments[0]);
        assert.include(contents, 'foo.Bar=function(){');
        done();
      });
    });

    it('should compile static code when the option is set explicitly', function (done) {
      compile('basic', { json: false }).then(({ inspect }) => {
        const contents = minify(inspect.arguments[0]);
        assert.include(contents, 'foo.Bar=function(){');
        done();
      });
    });
  });

  describe('with an invalid protobuf file', function () {
    it('should throw a compilation error', function (done) {
      compile('invalid').catch((err) => {
        assert.equal(err, 'compilation error');
        done();
      });
    });
  });

  describe('with command line options', function () {
    it('should pass command line options to the pbjs call', function (done) {
      compile('basic', { pbjsArgs: ['--no-encode'] }).then(({ inspect }) => {
        const contents = minify(inspect.arguments[0]);

        // Sanity check
        const innerString = 'Bar.decode=function decode(reader,length)';
        assert.include(contents, innerString);

        assert.notInclude(contents, 'encode');
        done();
      });
    });
  });

  describe('with imports', function () {
    beforeEach(function () {
      this.innerString =
        'addJSON({foo:{nested:{NotBar:{fields:{bar:{type:"Bar",id:1}}},Bar:{fields:{baz:{type:"string",id:1}}}}}})})';
    });

    it('should respect the webpack paths configuration', function (done) {
      const { innerString } = this;
      compile(
        'import',
        {
          json: true,
        },
        {
          resolve: {
            modules: ['node_modules', path.resolve(__dirname, 'fixtures')],
          },
        }
      ).then(({ inspect }) => {
        const contents = minify(inspect.arguments[0]);
        assert.include(contents, innerString);
        done();
      });
    });

    it('should respect an explicit paths configuration', function (done) {
      const { innerString } = this;
      compile('import', {
        json: true,
        paths: [path.resolve(__dirname, 'fixtures')],
      }).then(({ inspect }) => {
        const contents = minify(inspect.arguments[0]);
        assert.include(contents, innerString);
        done();
      });
    });

    it('should add the imports as dependencies', function (done) {
      compile('import', { paths: [path.resolve(__dirname, 'fixtures')] }).then(
        ({ inspect }) => {
          assert.include(
            // This method is missing from the typings for older webpack
            // versions, but it's supported in practice. If we drop
            // support for v4 and below, we can remove this.
            //
            // @ts-ignore
            inspect.context.getDependencies(),
            path.resolve(__dirname, 'fixtures', 'basic.proto')
          );
          done();
        }
      );
    });

    it('should fail when the import is not found', function (done) {
      compile('import', {
        json: true,
        // No include paths provided, so the 'import' fixture should
        // fail to compile.
      }).catch((err) => {
        assert.equal(err, 'compilation error');
        done();
      });
    });
  });
});
