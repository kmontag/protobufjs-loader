module.exports = {
  extends: [
    'eslint:recommended',
    'airbnb-base',
    'plugin:mocha/recommended',
    'prettier',
  ],
  env: {
    es6: true,
    node: true,
  },
  plugins: ['mocha'],
  rules: {
    'no-underscore-dangle': [
      'error',
      {
        allowAfterThis: true,
      },
    ],
  },
  overrides: [
    {
      // Mocha makes extensive use of the `this` context, so anonymous
      // non-arrow functions are reasonable in test files.
      files: ['test/*.test.js'],
      rules: {
        'func-names': 0,
        'prefer-arrow-callback': 0,
      },
    },
  ],
};
