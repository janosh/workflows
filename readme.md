# Reusable GitHub Action Workflows

## Workflows

- [`nodejs-gh-pages.yml`](.github/workflows/nodejs-gh-pages.yml) - Build a static site (`build-cmd`, output in `build-dir`) and deploy it to GitHub Pages. PRs and non-default branches only build; pushes, manual and scheduled runs on the default branch deploy.
- [`npm-test.yml`](.github/workflows/npm-test.yml) - Run unit tests (`test-cmd`) and end-to-end tests (`e2e-test-cmd`, e.g. Playwright) for an NPM package. Either job is skipped when its command is empty.
- [`npm-publish.yml`](.github/workflows/npm-publish.yml) - Run `npm-test.yml`, then publish to NPM when triggered by a release. Uses `secrets.NPM_TOKEN`.
- [`pytest.yml`](.github/workflows/pytest.yml) - Run `pytest` for a Python package, optionally uploading `coverage.xml` to Codecov (`upload-coverage`, uses `secrets.CODECOV_TOKEN`).
- [`pypi-publish.yml`](.github/workflows/pypi-publish.yml) - Build the package with `uv build` and publish it to PyPI. Uses `secrets.PYPI_TOKEN`; call it from a release-triggered workflow.

## Actions

None yet.

## Docs

[GitHub Actions: Reusable Workflows](https://docs.github.com/actions/learn-github-actions/reusing-workflows)

## Useful Links

- [How to not run certain jobs on forked repos](https://stackoverflow.com/a/70776678)
