import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'

const exec_file = promisify(execFile)
const script_path = join(process.cwd(), `scripts`, `make-release-notes.ts`)

let base_dir: string
let test_dir: string

beforeAll(async () => {
  base_dir = await mkdtemp(join(tmpdir(), `release-notes-`))
})

afterAll(async () => {
  await rm(base_dir, { recursive: true })
})

beforeEach(async () => {
  test_dir = await mkdtemp(join(base_dir, `case-`))
})

async function create_test_files(files: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(([filename, content]) =>
      writeFile(join(test_dir, filename), content)
    ),
  )
}

async function run_script(
  args: string[] = [],
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await exec_file(`node`, [script_path, ...args], { cwd: test_dir })
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const exec_err = err as { stdout?: string; stderr?: string; code?: number | string }
    return {
      stdout: exec_err.stdout ?? ``,
      stderr: exec_err.stderr ?? ``,
      code: typeof exec_err.code === `number` ? exec_err.code : 1,
    }
  }
}

const pkg_json = (version: string) => JSON.stringify({ name: `test-pkg`, version })

test.each([
  [`package.json`, { 'package.json': pkg_json(`1.2.3`) }, `v1.2.3`],
  [`pyproject.toml`, { 'pyproject.toml': `[project]\nname = "test-pkg"\nversion = "2.3.4"` }, `v2.3.4`],
  [`v-prefixed version`, { 'package.json': pkg_json(`v1.2.3`) }, `v1.2.3`],
  [`complex pyproject.toml with multiple sections`, {
    'pyproject.toml': `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "test-pkg"
version = "4.5.6"
description = "Test package"

[tool.pytest.ini_options]
testpaths = ["tests"]`,
  }, `v4.5.6`],
  [`pyproject.toml with comments`, {
    'pyproject.toml': `# This is a comment\n[project]\nname = "test-pkg"\nversion = "6.7.8"`,
  }, `v6.7.8`],
  [`pyproject.toml with leading whitespace`, {
    'pyproject.toml': `[project]\n    name = "test-pkg"\n    version = "7.8.9"`,
  }, `v7.8.9`],
])(`detects version from %s`, async (_label, files, expected_version) => {
  await create_test_files(files)
  const { stdout } = await run_script()
  expect(stdout).toContain(`📦 Using version from project config: ${expected_version}`)
})

test(`package.json takes precedence over pyproject.toml`, async () => {
  await create_test_files({
    'package.json': pkg_json(`1.0.0`),
    'pyproject.toml': `[project]\nname = "test-pkg"\nversion = "2.0.0"`,
  })
  const { stdout } = await run_script()
  expect(stdout).toContain(`📦 Using version from project config: v1.0.0`)
  expect(stdout).not.toContain(`v2.0.0`)
})

test(`explicit tag overrides config files`, async () => {
  await create_test_files({ 'package.json': pkg_json(`1.0.0`) })
  const { stdout } = await run_script([`v2.0.0`])
  expect(stdout).not.toContain(`📦 Using version from project config`)
  expect(stdout).toContain(`Generating release notes for v2.0.0`)
})

test(`custom changelog file argument`, async () => {
  await create_test_files({
    'package.json': pkg_json(`1.0.0`),
    'HISTORY.md': `# Changelog\n\n## [v0.1.0]\n\nInitial release`,
  })
  const { stdout } = await run_script([`v1.0.0`, `HISTORY.md`])
  expect(stdout).toContain(`Generating release notes for v1.0.0`)
})

const VERSION_ERROR = `No package.json or pyproject.toml with version found`

test.each([
  [`no config files`, {}],
  [`invalid JSON in package.json`, { 'package.json': `invalid json` }],
  [`malformed pyproject.toml`, { 'pyproject.toml': `invalid toml [` }],
  [`package.json without version`, { 'package.json': JSON.stringify({ name: `test-pkg` }) }],
  [`empty package.json`, { 'package.json': `{}` }],
  [`pyproject.toml without version`, { 'pyproject.toml': `[project]\nname = "test-pkg"` }],
  [`empty pyproject.toml`, { 'pyproject.toml': `` }],
])(`errors on %s`, async (_label, files) => {
  await create_test_files(files)
  const { stderr, code } = await run_script()
  expect(code).not.toBe(0)
  expect(stderr).toContain(VERSION_ERROR)
})
