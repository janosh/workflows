/// <reference lib="deno.ns" />

// Generate same release notes as GitHub and prepend to changelog.md
// Automatically detects previous tag and formats the changelog with deno fmt
// Usage: deno run -A make-release-notes.ts <tag_name> [changelog_file]
// E.g. deno run -A make-release-notes.ts v0.1.0 changelog.md

async function exec_cmd(cmd: string[]): Promise<string> {
  const { stdout } = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: `piped`,
  }).output()
  return new TextDecoder().decode(stdout).trim()
}

async function get_repo_info() {
  return JSON.parse(await exec_cmd([`gh`, `repo`, `view`, `--json`, `owner,name`]))
}

async function find_previous_tag(current_tag: string): Promise<string | undefined> {
  try {
    const tags = (await exec_cmd([`git`, `tag`, `--sort=-version:refname`]))
      .split(`\n`).filter((tag) => tag.trim())

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
  const lines = (await Deno.readTextFile(changelog_file)).split(`\n`)
  const header_idx = lines.findIndex((line) => line.trim() === `# Changelog`)

  if (header_idx === -1) {
    throw new Error(`Could not find "# Changelog" header in ${changelog_file}`)
  }

  const date = new Date().toLocaleDateString(`en-GB`, {
    day: `numeric`,
    month: `long`,
    year: `numeric`,
  })

  const compare_url = previous_tag
    ? `https://github.com/janosh/matterviz/compare/${previous_tag}...${tag_name}`
    : `https://github.com/janosh/matterviz/releases/tag/${tag_name}`

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
  await exec_cmd([`deno`, `fmt`, changelog_file])
}

async function main(): Promise<void> {
  const [tag_name, changelog_file = `changelog.md`] = Deno.args

  if (!tag_name) {
    console.error(`❌ Error: No tag name specified!

Usage: deno run -A make-release-notes.ts <tag_name> [changelog_file]
Examples:
  deno run -A make-release-notes.ts v1.0.0           # Auto-detects previous tag
  deno run -A make-release-notes.ts v1.1.0 HISTORY.md # Custom changelog file`)
    Deno.exit(1)
  }

  const previous_tag = await find_previous_tag(tag_name)
  const comparison = previous_tag ? `comparing with ${previous_tag}` : `first release`
  console.log(`Generating release notes for ${tag_name} (${comparison})...`)

  const release_notes = await generate_release_notes(tag_name, previous_tag)
  const processed_notes = release_notes
    .replace(/^## What's Changed$/m, `## ${tag_name}`)
    .replace(
      /<!-- Release notes generated using configuration in \.github\/release\.yml at main -->\s*/g,
      ``,
    )

  console.log(`\n${processed_notes}\n`)
  await prepend_to_changelog(processed_notes, tag_name, previous_tag, changelog_file)
  console.log(`✓ Release notes added to ${changelog_file}`)
}

if (import.meta.main) await main()
