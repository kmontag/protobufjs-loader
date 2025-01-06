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
        target: 'json-module',
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
      compile('basic', { target: 'static-module' }).then(({ inspect }) => {
        const contents = minify(inspect.arguments[0]);
        assert.include(contents, 'foo.Bar=function(){');
        done();
      });
    });

    describe('with typescript compilation', function () {
      beforeEach(function (done) {
        // Typescript generation requires that we write files directly
        // when the loader is invoked, rather than passing content
        // upstream to webpack for later assembly.
        //
        // To avoid polluting the local file system with these
        // compiled definitions, we perform the compilation in a tmp
        // directory.
        const fixturesPath = path.resolve(__dirname, 'fixtures');
        tmp.dir((err, tmpDir, cleanup) => {
          if (err) {
            throw err;
          }

          this.tmpDir = tmpDir;
          this.cleanup = cleanup;

          glob(path.join(fixturesPath, '**', '*.proto'), (globErr, files) => {
            if (globErr) {
              throw globErr;
            }
            Promise.all(
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
            ).then(() => {
              const target = path.resolve(__dirname, '..', 'node_modules');
              const link = path.join(tmpDir, 'node_modules');
              fs.symlink(target, link, (symlinkErr) => {
                if (symlinkErr) {
                  throw symlinkErr;
                }
                done();
              });
            });
          });
        });
      });

      afterEach(function () {
        if (this.cleanup) {
          this.cleanup();
        }
      });

      it('should not compile typescript by default', function (done) {
        compile(path.join(this.tmpDir, 'basic')).then(() => {
          glob(path.join(this.tmpDir, '*.d.ts'), (err, files) => {
            if (err) {
              throw err;
            }
            assert.equal(0, files.length);
            done();
          });
        });
      });

      it('should compile typescript when enabled', function (done) {
        compile(path.join(this.tmpDir, 'basic'), { pbts: true }).then(() => {
          // By default, definitions should just be siblings of their
          // associated .proto file.
          glob(path.join(this.tmpDir, '**', '*.d.ts'), (globErr, files) => {
            if (globErr) {
              throw globErr;
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
              assert.include(declarations, 'public baz: string;');
              assert.include(declarations, 'public static decodeDelimited');
              done();
            });
          });
        });
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

      describe('with custom declaration output locations', function () {
        /**
         * Helper function to assert that declarations for the basic
         * fixture can be saved to a custom location. Allows providing
         * either a plain string location, or a promise resolving to
         * the location.
         *
         * Return a promise resolving to true as a simple sanity check
         * that all assertions completed successfully.
         *
         * @type { (tmpDir: string, location: string | Promise<string>) => Promise<boolean> }
         */
        const assertSavesDeclarationToCustomLocation = (tmpDir, location) => {
          let outputInvocationCount = 0;

          /**
           * @type { (input: string) => string | Promise<string> }
           */
          const output = (input) => {
            outputInvocationCount += 1;
            assert.equal(
              fs.realpathSync(input),
              fs.realpathSync(path.join(tmpDir, 'basic.proto'))
            );
            return location;
          };

          return compile(path.join(tmpDir, 'basic'), {
            pbts: {
              output,
            },
          }).then(() => {
            assert.equal(outputInvocationCount, 1);

            return Promise.resolve(location).then((locationStr) => {
              const content = fs.readFileSync(locationStr).toString();
              assert.include(content, 'class Bar implements IBar');
              return true;
            });
          });
        };

        it('should save a declaration file to a synchronously-generated location', function (done) {
          tmp.dir((err, altTmpDir, cleanup) => {
            if (err) {
              throw err;
            }
            assertSavesDeclarationToCustomLocation(
              this.tmpDir,
              path.join(altTmpDir, 'alt.d.ts')
            ).then((result) => {
              assert.isTrue(result);
              cleanup();
              done();
            });
          });
        });

        it('should save a declaration file to an asynchronously-generated location', function (done) {
          tmp.dir((err, altTmpDir, cleanup) => {
            if (err) {
              throw err;
            }
            assertSavesDeclarationToCustomLocation(
              this.tmpDir,
              new Promise((resolve) => {
                setTimeout(() => {
                  resolve(path.join(altTmpDir, 'alt.d.ts'));
                }, 5);
              })
            ).then((result) => {
              assert.isTrue(result);
              cleanup();
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

    it('should respect the webpack paths configuration', function (done) {
      const { innerString } = this;
      compile(
        'import',
        {
          target: 'json-module',
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
        target: 'json-module',
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
        target: 'json-module',
        // No include paths provided, so the 'import' fixture should
        // fail to compile.
      }).catch((err) => {
        // The exact error that comes back from protobufjs differs
        // depending on the package version, so we have to just check
        // the webpack-specific portion of the error message.
        assert.include(`${err}`, 'ModuleBuildError: Module build failed');
        done();
      });
    });
  });

  describe('with invalid options', function () {
    it('should fail if unrecognized properties are added', function (done) {
      compile('basic', {
        target: 'json-module',
        foo: true,
      }).catch((err) => {
        assert.include(`${err}`, "configuration has an unknown property 'foo'");
        done();
      });
    });
  });
});
