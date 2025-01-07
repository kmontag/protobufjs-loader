/**
 * Semantic release config object.
 *
 * @type {Partial<import('semantic-release').GlobalConfig>}
 */
const config = {
  // For defaults see:
  // https://github.com/semantic-release/semantic-release/blob/master/docs/usage/configuration.md#plugins
  plugins: [
    // Treat refactors as patch releases. See
    // https://github.com/semantic-release/commit-analyzer?tab=readme-ov-file#usage.
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'angular',
        releaseRules: [{ type: 'refactor', release: 'patch' }],
      },
    ],
    '@semantic-release/release-notes-generator',
    // Publish releases to NPM.
    '@semantic-release/npm',
    // Publish releases to GitHub.
    '@semantic-release/github',
  ],
};

module.exports = config;
