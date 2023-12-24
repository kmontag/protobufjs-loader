# Contributing

Contributions are greatly appreciated.

### PR conventions

The project uses
[`semantic-release`](https://github.com/semantic-release/semantic-release),
meaning that a new release will be published whenever functional
changes are pushed to the `master` branch.

Commits must follow the [Conventional Commits
Spec](https://www.conventionalcommits.org/en/v1.0.0/), e.g. `fix: some
fix` (for a patch version release) or `feat: some feature` (for a
minor version release).

### CI Validations

PRs need to pass the following checks before they can be merged:

```sh
npm run check # Validates types.
npm run lint  # Validates code style.
npm run test  # Validates functionality.
```

If you have linting errors, you may be able to fix them automatically
using:

```sh
npm run fix
```
