/**
 * Semantic release config object.
 *
 * @type {Partial<import('semantic-release').GlobalConfig>}
 */
const config = {
  // For defaults see:
  // https://github.com/semantic-release/semantic-release/blob/master/docs/usage/configuration.md#plugins
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        // Use conventionalcommits instead of angular, which is likely
        // to become the new default at some point, and supports more
        // extensive configuration. See
        // https://github.com/semantic-release/semantic-release/pull/1836.
        preset: 'conventionalcommits',
        // Treat refactors as patch releases. See
        // https://github.com/semantic-release/commit-analyzer?tab=readme-ov-file#usage.
        releaseRules: [{ type: 'refactor', release: 'patch' }],
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
        presetConfig: {
          types: [
            // Default sections, see https://github.com/conventional-changelog/conventional-changelog-config-spec/blob/master/versions/2.2.0/README.md#types.
            { type: 'feat', section: 'Features' },
            { type: 'fix', section: 'Bug Fixes' },
            { type: 'chore', hidden: true },
            { type: 'docs', hidden: true },
            { type: 'style', hidden: true },
            { type: 'test', hidden: true },

            // Overrides for additional patch release types.
            { type: 'refactor', section: 'Refactors', hidden: false },
            { type: 'perf', section: 'Performance', hidden: false },
          ],
        },
      },
    ],
    // Publish releases to NPM.
    '@semantic-release/npm',
    // Publish releases to GitHub.
    '@semantic-release/github',
  ],
};

module.exports = config;
