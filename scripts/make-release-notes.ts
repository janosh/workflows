// Generate same release notes as GitHub and prepend to changelog.md
// Automatically detects previous tag
// Usage: node scripts/make-release-notes.ts [tag_name] [changelog_file]
// E.g. node scripts/make-release-notes.ts v0.1.0 changelog.md

import { execFile } from 'node:child_process'
import { access, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

const exec_file = promisify(execFile)

async function exec_cmd(cmd: string[]): Promise<string> {
  const { stdout } = await exec_file(cmd[0], cmd.slice(1))
  return stdout.trim()
}

async function find_config_file(
  filename: string,
  start_dir: string = process.cwd(),
): Promise<string | null> {
  let current_dir = start_dir
  while (current_dir !== `/` && current_dir !== `.`) {
    const file_path = `${current_dir}/${filename}`
    try {
      await access(file_path)
      return file_path
    } catch {
      const parent_dir = dirname(current_dir)
      if (parent_dir === current_dir) break
      current_dir = parent_dir
    }
  }
  return null
}

function parse_pyproject(
  content: string,
): { name: string; version: string } | null {
  const lines = content.split(`\n`)
  let in_project = false
  let name: string | undefined
  let version: string | undefined

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith(`[`)) {
      in_project = trimmed === `[project]`
      continue
    }
    if (!in_project || trimmed.startsWith(`#`) || !trimmed) continue

    const match = trimmed.match(/^(\w+)\s*=\s*"([^"]*)"/)
    if (match) {
      if (match[1] === `name`) name = match[2]
      if (match[1] === `version`) version = match[2]
    }
  }

  return version ? { name: name || `unknown`, version } : null
}

async function get_pkg_info(): Promise<{ name: string; version: string }> {
  const search_dirs = [process.cwd()]
  try {
    search_dirs.unshift(await exec_cmd([`git`, `rev-parse`, `--show-toplevel`]))
  } catch {
    // not in a git repo, just search cwd
  }

  for (const search_dir of search_dirs) {
    for (
      const [filename, parser] of [
        [`package.json`, (content: string) => {
          const { name, version } = JSON.parse(content)
          return version ? { name: name || `unknown`, version } : null
        }],
        [`pyproject.toml`, parse_pyproject],
      ] as const
    ) {
      const file_path = await find_config_file(filename, search_dir)
      if (file_path) {
        try {
          const result = parser(await readFile(file_path, `utf-8`))
          if (result) return result as { name: string; version: string }
        } catch {
          // malformed file, try next
        }
      }
    }
  }

  throw new Error(
    `No package.json or pyproject.toml with version found in git root or current directory`,
  )
}

async function get_repo_info(): Promise<{ owner: { login: string }; name: string }> {
  return JSON.parse(await exec_cmd([`gh`, `repo`, `view`, `--json`, `owner,name`]))
}

async function find_previous_tag(current_tag: string): Promise<string | undefined> {
  let tag_output: string
  try {
    tag_output = await exec_cmd([`git`, `tag`, `--sort=-version:refname`])
  } catch {
    return undefined
  }
  const tags = tag_output.split(`\n`).filter(Boolean)
  if (!tags.length) return undefined
  const idx = tags.indexOf(current_tag)
  return idx !== -1 && idx < tags.length - 1 ? tags[idx + 1] : tags[0]
}

async function generate_release_notes(
  tag_name: string,
  previous_tag?: string,
): Promise<string> {
  const { owner, name } = await get_repo_info()
  const request_body: { tag_name: string; previous_tag_name?: string } = { tag_name }
  if (previous_tag?.trim()) request_body.previous_tag_name = previous_tag

  const { stdout } = await exec_file(`gh`, [
    `api`, `repos/${owner.login}/${name}/releases/generate-notes`, `--input`, `-`,
  ], { input: JSON.stringify(request_body) })

  return JSON.parse(stdout).body
}

async function prepend_to_changelog(
  processed_notes: string,
  tag_name: string,
  previous_tag: string | undefined,
  changelog_file: string,
): Promise<void> {
  const lines = (await readFile(changelog_file, `utf-8`)).split(`\n`)
  const header_idx = lines.findIndex((line) => line.trim() === `# Changelog`)

  if (header_idx === -1) {
    throw new Error(`Could not find "# Changelog" header in ${changelog_file}`)
  }

  const date = new Date().toLocaleDateString(`en-GB`, {
    day: `numeric`,
    month: `long`,
    year: `numeric`,
  })
  const [repo_info, pkg_info] = await Promise.all([get_repo_info(), get_pkg_info()])
  const project_name = pkg_info.name || repo_info.name
  const base_url = `https://github.com/${repo_info.owner.login}/${project_name}`
  const compare_url = previous_tag
    ? `${base_url}/compare/${previous_tag}...${tag_name}`
    : `${base_url}/releases/tag/${tag_name}`

  lines.splice(
    header_idx + 1,
    0,
    [
      ``,
      `## [${tag_name}](${compare_url})`,
      ``,
      `> ${date}`,
      ``,
      processed_notes.replace(/^## .+$/m, ``).trim(),
      ``,
    ].join(`\n`),
  )
  await writeFile(changelog_file, lines.join(`\n`))
}

async function main(): Promise<void> {
  const [provided_tag, changelog_file = `changelog.md`] = process.argv.slice(2)

  let tag_name = provided_tag
  if (!tag_name) {
    const pkg = await get_pkg_info()
    tag_name = pkg.version.startsWith(`v`) ? pkg.version : `v${pkg.version}`
    console.log(`📦 Using version from project config: ${tag_name}`)
  }

  const previous_tag = await find_previous_tag(tag_name)
  console.log(
    `Generating release notes for ${tag_name} (${
      previous_tag ? `comparing with ${previous_tag}` : `first release`
    })...`,
  )

  const processed_notes = (await generate_release_notes(tag_name, previous_tag))
    .replace(/^## What's Changed$/m, `## ${tag_name}`)
    .replace(
      /<!-- Release notes generated using configuration in \.github\/release\.yml at main -->\s*/g,
      ``,
    )
    .replace(/^\* /gm, `- `)
    .replace(/\*\*Full Changelog\*\*: .+\n?/g, ``)

  await prepend_to_changelog(processed_notes, tag_name, previous_tag, changelog_file)
  console.log(`✓ Release notes added to ${changelog_file}`)
}

if (import.meta.filename === resolve(process.argv[1])) {
  try {
    await main()
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
