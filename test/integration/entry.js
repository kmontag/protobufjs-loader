/**
 * Entry point for the integration build. The `.proto` import is
 * compiled by the loader during the webpack build, and the resulting
 * module is exercised with an encode/decode roundtrip whose result is
 * printed as JSON for verification.
 */

// The `.proto` module is only resolvable through webpack.
//
// @ts-expect-error
const { example } = require('./greeting.proto');

const message = example.Greeting.create({ text: 'hello', count: 3 });
const encoded = example.Greeting.encode(message).finish();
const decoded = example.Greeting.decode(encoded);

console.log(
  JSON.stringify({ decoded: decoded.toJSON(), encodedLength: encoded.length }),
);
