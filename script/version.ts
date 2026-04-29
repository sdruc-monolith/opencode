#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"

const output = [`version=${Script.version}`]
const sha = process.env.GITHUB_SHA ?? (await $`git rev-parse HEAD`.text()).trim()
const repo = process.env.GH_REPO

if (!Script.preview) {
  if (process.env.OPENCODE_API_KEY) {
    const changelog = await $`bun script/changelog.ts --to ${sha}`.cwd(process.cwd()).nothrow()
    if (changelog.exitCode !== 0) console.warn("failed to generate changelog; using fallback release notes")
  } else {
    console.warn("OPENCODE_API_KEY is not set; using fallback release notes")
  }
  const file = `${process.cwd()}/UPCOMING_CHANGELOG.md`
  const body = await Bun.file(file)
    .text()
    .catch(() => "No notable changes")
  const dir = process.env.RUNNER_TEMP ?? "/tmp"
  const notesFile = `${dir}/opencode-release-notes.txt`
  await Bun.write(notesFile, body)
  if (repo) {
    await $`gh release create v${Script.version} -d --target ${sha} --title "v${Script.version}" --notes-file ${notesFile} --repo ${repo}`
  } else {
    await $`gh release create v${Script.version} -d --target ${sha} --title "v${Script.version}" --notes-file ${notesFile}`
  }
  const release = repo
    ? await $`gh release view v${Script.version} --json tagName,databaseId --repo ${repo}`.json()
    : await $`gh release view v${Script.version} --json tagName,databaseId`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
} else if (Script.channel === "beta") {
  await $`gh release create v${Script.version} -d --title "v${Script.version}" --repo ${repo}`
  const release =
    await $`gh release view v${Script.version} --json tagName,databaseId --repo ${repo}`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
}

output.push(`repo=${repo}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
