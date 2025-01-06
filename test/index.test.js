const { assert } = require('chai');
const fs = require('fs');
const path = require('path');
const tmp = require('tmp');
const UglifyJS = require('uglify-js');

const glob = require('glob');
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

/**
 * Promisified glob function for convenience.
 *
 * @type { (globStr: string) => Promise<string[]> }
 */
const globPromise = (globStr) => {
  return new Promise((resolve, reject) => {
    glob(globStr, (err, files) => {
      if (err) {
        reject(err);
      } else {
        resolve(files);
      }
    });
  });
};

describe('protobufjs-loader', function () {
  before(async function () {
    // The first time the compiler gets run (e.g. in a CI environment),
    // some additional packages will be installed in the
    // background. This can take awhile and trigger a timeout, so we do
    // it here explicitly first.
    this.timeout(10000);
    await compile('basic');
  });

  describe('with JSON / reflection', function () {
    beforeEach(function () {
      this.opts = {
        target: 'json-module',
      };
    });

    it('should compile to a JSON representation', async function () {
      const { inspect } = await compile('basic', this.opts);
      const contents = minify(inspect.arguments[0]);
      const innerString =
        'addJSON({foo:{nested:{Bar:{fields:{baz:{type:"string",id:1}}}}}})})';
      assert.include(contents, innerString);
    });
  });

  describe('with static code', function () {
    it('should compile static code by default', async function () {
      const { inspect } = await compile('basic');
      const contents = minify(inspect.arguments[0]);
      assert.include(contents, 'foo.Bar=function(){');
    });

    it('should compile static code when the option is set explicitly', async function () {
      const { inspect } = await compile('basic', { target: 'static-module' });
      const contents = minify(inspect.arguments[0]);
      assert.include(contents, 'foo.Bar=function(){');
    });

    describe('with typescript compilation', function () {
      beforeEach(async function () {
        // Typescript generation requires that we write files directly
        // when the loader is invoked, rather than passing content
        // upstream to webpack for later assembly.
        //
        // To avoid polluting the local file system with these
        // compiled definitions, we perform the compilation in a tmp
        // directory.
        const fixturesPath = path.resolve(__dirname, 'fixtures');
        const [tmpDir, cleanup] = await new Promise((resolve, reject) => {
          tmp.dir((err, tmpDir, cleanup) => {
            if (err) {
              reject(err);
            } else {
              resolve([tmpDir, cleanup]);
            }
          });
        });

        this.tmpDir = tmpDir;
        this.cleanup = cleanup;

        const files = await globPromise(
          path.join(fixturesPath, '**', '*.proto')
        );

        await Promise.all(
          files.map((file) => {
            const targetPath = path.join(
              tmpDir,
              path.relative(fixturesPath, file)
            );

            return new Promise((resolve, reject) => {
              // Create subdirectories if necessary.
              fs.mkdir(
                path.dirname(targetPath),
                { recursive: true },
                (mkdirErr) => {
                  if (mkdirErr) {
                    reject(mkdirErr);
                  } else {
                    fs.copyFile(file, targetPath, (copyErr) => {
                      if (copyErr) {
                        reject(copyErr);
                      } else {
                        resolve(undefined);
                      }
                    });
                  }
                }
              );
            });
          })
        );
        const target = path.resolve(__dirname, '..', 'node_modules');
        const link = path.join(tmpDir, 'node_modules');

        /** @type { Promise<void> } */
        const symlinkNodeModulesPromise = new Promise((resolve, reject) => {
          fs.symlink(target, link, (symlinkErr) => {
            if (symlinkErr) {
              reject(symlinkErr);
            } else {
              resolve();
            }
          });
        });

        await symlinkNodeModulesPromise;
      });

      afterEach(function () {
        if (this.cleanup) {
          this.cleanup();
        }
      });

      it('should not compile typescript by default', async function () {
        await compile(path.join(this.tmpDir, 'basic'));
        const files = await globPromise(path.join(this.tmpDir, '*.d.ts'));
        assert.equal(0, files.length);
      });

      it('should compile typescript when enabled', async function () {
        await compile(path.join(this.tmpDir, 'basic'), { pbts: true });
        // By default, definitions should just be siblings of their
        // associated .proto file.
        const files = await globPromise(path.join(this.tmpDir, '*.d.ts'));
        const expectedDefinitionsFile = path.join(
          this.tmpDir,
          'basic.proto.d.ts'
        );
        assert.sameMembers([expectedDefinitionsFile], files);

        /** @type { string } */
        const declarations = await new Promise((resolve, reject) => {
          fs.readFile(expectedDefinitionsFile, (readErr, content) => {
            if (readErr) {
              reject(readErr);
            } else {
              resolve(content.toString());
            }
          });
        });

        assert.include(declarations, 'public baz: string;');
        assert.include(declarations, 'public static decodeDelimited');
      });

      it('should compile nearly-empty declarations if typescript compilation is enabled for JSON output', function (done) {
        compile(path.join(this.tmpDir, 'basic'), {
          target: 'json-module',
          pbts: true,
        }).then(() => {
          glob(path.join(this.tmpDir, '*.d.ts'), (err, files) => {
            if (err) {
              throw err;
            }

            const expectedDefinitionsFile = path.join(
              this.tmpDir,
              'basic.proto.d.ts'
            );
            assert.sameMembers([expectedDefinitionsFile], files);

            fs.readFile(expectedDefinitionsFile, (readErr, content) => {
              if (readErr) {
                throw readErr;
              }
              const declarations = content.toString();
              // Make sure the main protobufjs import shows up.
              assert.include(
                declarations,
                'import * as $protobuf from "protobufjs";'
              );
              // Some versions of protobufjs-cli will also include
              // additional imports. Make sure all non-empty lines are
              // imports.
              declarations.split('\n').forEach((line) => {
                if (line.trim().length !== 0) {
                  assert.include(line, 'import');
                }
              });
              done();
            });
          });
        });
      });

      it('should pass arguments to pbts', function (done) {
        compile(path.join(this.tmpDir, 'basic'), {
          pbts: {
            args: ['-n', 'testModuleName'],
          },
        }).then(() => {
          glob(path.join(this.tmpDir, '*.d.ts'), (globErr, files) => {
            if (globErr) {
              throw globErr;
            }
            const expectedDeclarationFile = path.join(
              this.tmpDir,
              'basic.proto.d.ts'
            );
            assert.sameMembers([expectedDeclarationFile], files);

            fs.readFile(expectedDeclarationFile, (readErr, content) => {
              if (readErr) {
                throw readErr;
              }
              const declarations = content.toString();
              assert.include(declarations, 'public baz: string;');
              assert.include(declarations, 'public static decodeDelimited');
              assert.include(declarations, 'declare namespace testModuleName');
              done();
            });
          });
        });
      });

      describe('with imports', function () {
        it('should compile imported definitions', function (done) {
          compile(path.join(this.tmpDir, 'import'), {
            paths: [this.tmpDir],
            pbts: true,
          }).then(() => {
            glob(path.join(this.tmpDir, '**', '*.d.ts'), (globErr, files) => {
              if (globErr) {
                throw globErr;
              }
              const expectedDeclarationFile = path.join(
                this.tmpDir,
                'import.proto.d.ts'
              );
              assert.sameMembers([expectedDeclarationFile], files);

              fs.readFile(expectedDeclarationFile, (readErr, content) => {
                if (readErr) {
                  throw readErr;
                }
                const declarations = content.toString();

                // Check that declarations from the top-level `import`
                // fixture are present.
                assert.include(
                  declarations,
                  'class NotBar implements INotBar {'
                );

                // Check that declarations from the imported `basic`
                // fixture are present.
                assert.include(declarations, 'class Bar implements IBar');

                // Check that declarations imported from the
                // subdirectory are present.
                assert.include(declarations, 'class Baz implements IBaz');
                assert.include(declarations, 'namespace sub');

                done();
              });
            });
          });
        });
      });
    });
  });

  describe('with an invalid protobuf file', function () {
    it('should throw a compilation error', function (done) {
      compile('invalid').catch((err) => {
        assert.include(`${err}`, "illegal token 'invalid'");
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
        '.addJSON({foo:{nested:{NotBar:{fields:{bar:{type:"Bar",id:1}}},Bar:{fields:{baz:{type:"string",id:1}}},sub:{nested:{Baz:{fields:{id:{type:"int32",id:1}}}}}}}})});';
    });

    it('should respect the webpack paths configuration', async function () {
      const { innerString } = this;
      const { inspect } = await compile(
        'import',
        {
          target: 'json-module',
        },
        {
          resolve: {
            modules: ['node_modules', path.resolve(__dirname, 'fixtures')],
          },
        }
      );
      const contents = minify(inspect.arguments[0]);
      assert.include(contents, innerString);
    });

    it('should respect an explicit paths configuration', async function () {
      const { innerString } = this;
      const { inspect } = await compile('import', {
        target: 'json-module',
        paths: [path.resolve(__dirname, 'fixtures')],
      });
      const contents = minify(inspect.arguments[0]);
      assert.include(contents, innerString);
    });

    it('should add the imports as dependencies', async function () {
      const { inspect } = await compile('import', {
        paths: [path.resolve(__dirname, 'fixtures')],
      });

      assert.sameMembers(inspect.context.getDependencies(), [
        // The main proto file should be included.
        path.resolve(__dirname, 'fixtures', 'import.proto'),

        // Imported files should also be included.
        path.resolve(__dirname, 'fixtures', 'basic.proto'),
        path.resolve(__dirname, 'fixtures', 'sub', 'baz.proto'),
      ]);
    });

    it('should fail when the import is not found', async function () {
      let didError = false;
      try {
        await compile('import', {
          target: 'json-module',
          // No include paths provided, so the 'import' fixture should
          // fail to compile.
        });
      } catch (err) {
        didError = true;
        // The exact error that comes back from protobufjs differs
        // depending on the package version, so we have to just check
        // the webpack-specific portion of the error message.
        assert.include(`${err}`, 'ModuleBuildError: Module build failed');
      }
      assert.isTrue(didError);
    });
  });

  describe('with invalid options', function () {
    it('should fail if unrecognized properties are added', async function () {
      let didError = false;
      try {
        await compile('basic', {
          target: 'json-module',
          foo: true,
        });
      } catch (err) {
        didError = true;
        assert.include(`${err}`, "configuration has an unknown property 'foo'");
      }
      assert.isTrue(didError);
    });
  });
});
