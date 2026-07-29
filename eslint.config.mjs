import js from '@eslint/js';
import mocha from 'eslint-plugin-mocha';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    // Build output of the integration test.
    ignores: ['test/integration/dist/'],
  },
  js.configs.recommended,
  mocha.configs.recommended,
  prettier,
  {
    // The loader and tests are CommonJS; this config file itself is
    // the only ES module, handled by the override below.
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-underscore-dangle': ['error', { allowAfterThis: true }],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    // Mocha makes extensive use of the `this` context, so anonymous
    // non-arrow functions are reasonable in test files.
    files: ['test/**/*.js'],
    rules: {
      'func-names': 'off',
      'prefer-arrow-callback': 'off',
    },
  },
];
