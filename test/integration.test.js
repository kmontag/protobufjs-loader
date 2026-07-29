const { assert } = require('chai');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const integrationPath = path.resolve(__dirname, 'integration');
const distPath = path.join(integrationPath, 'dist');

/**
 * Prints build logs and artifacts for visual inspection when the
 * PROTOBUFJS_LOADER_TEST_VERBOSE environment variable is set.
 *
 * @type { (message: string) => void }
 */
const logVerbose = (message) => {
  if (process.env.PROTOBUFJS_LOADER_TEST_VERBOSE) {
    console.log(message);
  }
};

/**
 * End-to-end test which performs a real webpack build (writing to the
 * filesystem, unlike the unit tests) and then executes the resulting
 * bundle. The assertions only check outputs which could not exist
 * unless the full build succeeded; set PROTOBUFJS_LOADER_TEST_VERBOSE
 * to also print the artifacts and build logs for visual inspection.
 */
describe('integration', function () {
  // Allow time for the full webpack build.
  this.timeout(60000);

  before(function () {
    // Remove any stale artifacts, so that a passing test can only
    // result from a successful fresh build.
    fs.rmSync(distPath, { recursive: true, force: true });

    const output = execFileSync(
      process.execPath,
      [path.join(integrationPath, 'build.js')],
      { encoding: 'utf8' },
    );
    logVerbose(output);
  });

  it('executes the bundle and gets the expected roundtrip output', function () {
    const output = execFileSync(
      process.execPath,
      [path.join(distPath, 'main.js')],
      { encoding: 'utf8' },
    );
    logVerbose(`bundle output: ${output}`);

    assert.deepEqual(JSON.parse(output), {
      decoded: { text: 'hello', count: 3 },
      encodedLength: 9,
    });
  });

  it('writes typescript declarations for the compiled proto', function () {
    const declarations = fs.readFileSync(
      path.join(distPath, 'greeting.proto.d.ts'),
      'utf8',
    );
    logVerbose(declarations);

    assert.include(declarations, 'namespace example');
    assert.include(declarations, 'class Greeting');
    assert.include(declarations, 'text');
  });
});
