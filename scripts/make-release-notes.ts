/// <reference lib="deno.ns" />

// Generate GitHub release notes and prepend to changelog.md
// Automatically formats the changelog with deno fmt
// Usage: deno run -A make-release-notes.ts <tag_name> [previous_tag] [changelog_file]
// E.g. deno run -A make-release-notes.ts v0.1.0 v0.0.1 changelog.md

interface ReleaseNotesRequest {
  tag_name: string
  previous_tag_name?: string
}

async function exec_command(cmd: string[]): Promise<string> {
  const process = new Deno.Command(cmd[0], { args: cmd.slice(1), stdout: `piped` })
  const { stdout } = await process.output()
  return new TextDecoder().decode(stdout).trim()
}

async function get_repo_info(): Promise<{ owner: { login: string }; name: string }> {
  const output = await exec_command([`gh`, `repo`, `view`, `--json`, `owner,name`])
  return JSON.parse(output)
}

async function generate_release_notes(
  repo: { owner: { login: string }; name: string },
  tag_name: string,
  previous_tag?: string,
): Promise<string> {
  const request_body: ReleaseNotesRequest = { tag_name }
  if (previous_tag?.trim()) request_body.previous_tag_name = previous_tag

  const process = new Deno.Command(`gh`, {
    args: [
      `api`,
      `repos/${repo.owner.login}/${repo.name}/releases/generate-notes`,
      `--input`,
      `-`,
    ],
    stdin: `piped`,
    stdout: `piped`,
  })

  const child = process.spawn()
  const writer = child.stdin.getWriter()
  await writer.write(new TextEncoder().encode(JSON.stringify(request_body)))
  await writer.close()

  const { code, stdout } = await child.output()
  if (code !== 0) throw new Error(`GitHub API call failed`)

  const response = JSON.parse(new TextDecoder().decode(stdout))
  return response.body
}

async function prepend_to_changelog(
  release_notes: string,
  tag_name: string,
  changelog_file: string,
): Promise<void> {
  const changelog = await Deno.readTextFile(changelog_file)
  const lines = changelog.split(`\n`)

  // Find insertion point (first #### entry)
  const insert_idx = lines.findIndex((line) => line.startsWith(`#### `))

  const date = new Date().toLocaleDateString(`en-GB`, {
    day: `numeric`,
    month: `long`,
    year: `numeric`,
  })

  const new_entry = [
    `#### [${tag_name}](https://github.com/janosh/matterviz/compare/${tag_name}...${tag_name})`,
    ``,
    `#### ${tag_name}`,
    ``,
    `> ${date}`,
    ``,
    release_notes.replace(/^## .+$/m, ``).trim(),
    ``,
    ``,
  ].join(`\n`)

  lines.splice(insert_idx, 0, new_entry)
  await Deno.writeTextFile(changelog_file, lines.join(`\n`))

  await exec_command([`deno`, `fmt`, changelog_file])
}

async function main(): Promise<void> {
  const [tag_name, previous_tag, changelog_file = `changelog.md`] = Deno.args

  if (!tag_name) {
    console.log(
      `Usage: ./make-release-notes.ts <tag_name> [previous_tag] [changelog_file]`,
    )
    Deno.exit(1)
  }

  const repo = await get_repo_info()

  console.log(`Generating release notes for ${tag_name}...`)

  const release_notes = await generate_release_notes(repo, tag_name, previous_tag)

  // Clean up the notes: replace title and remove GitHub comment
  const processed_notes = release_notes
    .replace(/^## What's Changed$/m, `## ${tag_name}`)
    .replace(
      /<!-- Release notes generated using configuration in \.github\/release\.yml at main -->\s*/g,
      ``,
    )

  console.log(`\n${processed_notes}\n`)

  await prepend_to_changelog(processed_notes, tag_name, changelog_file)
  console.log(`✓ Release notes added to ${changelog_file}`)
}

if (import.meta.main) await main()
