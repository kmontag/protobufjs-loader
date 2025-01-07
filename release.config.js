/**
 * Semantic release config object.
 *
 * @type {Partial<import('semantic-release').GlobalConfig>}
 */
const config = {
  // Treat refactors as patch releases. See
  // https://github.com/semantic-release/commit-analyzer?tab=readme-ov-file#usage.
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'angular',
        releaseRules: [{ type: 'refactor', release: 'patch' }],
      },
    ],
    '@semantic-release/release-notes-generator',
  ],
};

module.exports = config;
