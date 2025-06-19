// Generate same release notes as GitHub and prepend to changelog.md
// Automatically detects previous tag and formats the changelog with deno fmt
// Usage: deno run -A make-release-notes.ts [tag_name] [changelog_file]
// E.g. deno run -A make-release-notes.ts v0.1.0 changelog.md

import * as toml from 'jsr:@std/toml@^0.218.0'

async function exec_cmd(cmd: string[]): Promise<string> {
  const { stdout } = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: `piped`,
  }).output()
  return new TextDecoder().decode(stdout).trim()
}

async function find_config_file(
  filename: string,
  start_dir: string = Deno.cwd(),
): Promise<string | null> {
  let current_dir = start_dir
  while (current_dir !== `/` && current_dir !== `.`) {
    const file_path = `${current_dir}/${filename}`
    try {
      // deno-lint-ignore no-await-in-loop
      await Deno.stat(file_path)
      return file_path
    } catch {
      const parent_dir = current_dir.split(`/`).slice(0, -1).join(`/`)
      if (parent_dir === current_dir) break
      current_dir = parent_dir || `/`
    }
  }
  return null
}

async function get_pkg_info(): Promise<{ name: string; version: string } | null> {
  const search_dirs = [Deno.cwd()]
  try {
    search_dirs.unshift(await exec_cmd([`git`, `rev-parse`, `--show-toplevel`]))
  } catch {}

  for (const search_dir of search_dirs) {
    for (
      const [filename, parser] of [
        [`package.json`, (content: string) => {
          const { name, version } = JSON.parse(content)
          return version ? { name: name || `unknown`, version } : null
        }],
        [`pyproject.toml`, (content: string) => {
          const data = toml.parse(content) as {
            project?: { name?: string; version?: string }
          }
          return data.project?.version
            ? { name: data.project.name || `unknown`, version: data.project.version }
            : null
        }],
      ] as const
    ) {
      const file_path = await find_config_file(filename, search_dir)
      if (file_path) {
        try {
          const result = parser(await Deno.readTextFile(file_path))
          if (result) return result
        } catch (error) {
          console.warn(
            `⚠️  Error reading ${filename}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }
    }
  }

  console.warn(
    `⚠️  No package.json or pyproject.toml found in git root or current directory`,
  )
  return null
}

async function get_repo_info() {
  return JSON.parse(await exec_cmd([`gh`, `repo`, `view`, `--json`, `owner,name`]))
}

async function find_previous_tag(current_tag: string): Promise<string | undefined> {
  try {
    const tags = (await exec_cmd([`git`, `tag`, `--sort=-version:refname`])).split(`\n`)
      .filter(Boolean)
    if (!tags.length) return undefined
    const idx = tags.indexOf(current_tag)
    return idx !== -1 && idx < tags.length - 1 ? tags[idx + 1] : tags[0]
  } catch {
    return undefined
  }
}

async function generate_release_notes(
  tag_name: string,
  previous_tag?: string,
): Promise<string> {
  const { owner, name } = await get_repo_info()
  const request_body: { tag_name: string; previous_tag_name?: string } = { tag_name }
  if (previous_tag?.trim()) request_body.previous_tag_name = previous_tag

  const process = new Deno.Command(`gh`, {
    args: [`api`, `repos/${owner.login}/${name}/releases/generate-notes`, `--input`, `-`],
    stdin: `piped`,
    stdout: `piped`,
  })

  const child = process.spawn()
  const writer = child.stdin.getWriter()
  await writer.write(new TextEncoder().encode(JSON.stringify(request_body)))
  await writer.close()

  const { code, stdout } = await child.output()
  if (code !== 0) throw new Error(`GitHub API call failed`)

  return JSON.parse(new TextDecoder().decode(stdout)).body
}

async function prepend_to_changelog(
  processed_notes: string,
  tag_name: string,
  previous_tag: string | undefined,
  changelog_file: string,
): Promise<void> {
  let lines: string[]
  let header_idx: number

  try {
    lines = (await Deno.readTextFile(changelog_file)).split(`\n`)
    header_idx = lines.findIndex((line) => line.trim() === `# Changelog`)
  } catch {
    // File doesn't exist, create it with a header
    lines = [`# Changelog`]
    header_idx = 0
  }

  if (header_idx === -1) {
    throw new Error(`Could not find "# Changelog" header in ${changelog_file}`)
  }

  const date = new Date().toLocaleDateString(`en-GB`, {
    day: `numeric`,
    month: `long`,
    year: `numeric`,
  })
  const [repo_info, pkg_info] = await Promise.all([get_repo_info(), get_pkg_info()])
  const project_name = pkg_info?.name || repo_info.name
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
  await Deno.writeTextFile(changelog_file, lines.join(`\n`))
  await exec_cmd([`deno`, `fmt`, `--line-width=0`, changelog_file])
}

async function main(): Promise<void> {
  const [provided_tag, changelog_file = `changelog.md`] = Deno.args

  let tag_name = provided_tag
  if (!tag_name) {
    const pkg = await get_pkg_info()
    if (pkg?.version) {
      tag_name = pkg.version.startsWith(`v`) ? pkg.version : `v${pkg.version}`
      console.log(`📦 Using version from project config: ${tag_name}`)
    } else {
      console.error(
        `❌ Error: No tag name specified and no version found in package.json or pyproject.toml!

Usage: deno run -A make-release-notes.ts [tag_name] [changelog_file]
Examples:
  deno run -A make-release-notes.ts v1.0.0           # Specify tag explicitly
  deno run -A make-release-notes.ts                  # Use version from package.json or pyproject.toml
  deno run -A make-release-notes.ts v1.1.0 HISTORY.md # Custom changelog file`,
      )
      Deno.exit(1)
    }
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

if (import.meta.main) await main()
