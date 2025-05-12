# Reusable GitHub Action Workflows

## Workflows

- [`pypi-publish.yml`](.github/workflows/pypi-publish.yml) - Run all `pytest` functions for a PyPI package and release a new version to PyPI if all tests pass and the run was triggered by a release. Uses `secrets.PYPI_TOKEN` to authenticate with PyPI.
- [`nodejs-gh-pages.yml`](.github/workflows/nodejs-gh-pages.yml) - Deploy server-rendered static site to GitHub Pages
- [`npm-publish.yml`](.github/workflows/npm-publish.yml) - Run all tests for an NPM package (usually written in Playwright and vitest) and release a new version to NPM if all tests pass and the run was triggered by a release. Uses `secrets.NPM_TOKEN` to authenticate with NPM.
- [`pytest.yml`](.github/workflows/pytest.yml) - Run all `pytest` functions for a PyPI package.

## Actions

None yet.

## Docs

[GitHub Actions: Reusable Workflows](https://docs.github.com/actions/learn-github-actions/reusing-workflows)

## Useful Links

- [How to not run certain jobs on forked repos](https://stackoverflow.com/a/70776678)
