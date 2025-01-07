// -*- mode: js -*-
/**
 * @type {import('semantic-release').GlobalConfig}
 */
export default {
  plugins: [
    // Push patch releases on refactor.
    //
    // See https://github.com/semantic-release/commit-analyzer?tab=readme-ov-file#usage.
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
