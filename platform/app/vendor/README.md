# Vendor Directory

This directory contains vendored dependencies that are not published to npm.

## Contents

### @langwatch/scenario

**File:** `langwatch-scenario-1.7.0-dev.voice10.tgz`

The scenario testing SDK for LangWatch, vendored as a tarball so the app pins
known bits and can also carry unreleased builds when needed.

**Source:** https://github.com/langwatch/scenario

**Current build:** This is an unreleased build of langwatch/scenario at commit
`55de2020`, which is main with scenario PR #1001 merged: the judge maps each
criterion by its schema key rather than by position, reports inconclusive
criteria apart from unmet ones, waits out a quiet period before a trace counts
as settled, and retries an empty user-simulator answer. It is stamped as the
prerelease `1.7.0-dev.voice10`. The version stamp is set locally before
`pnpm buildpack` and is not committed in the scenario repo, where main stays on
its released version. Swap this for the real npm 1.7.0 artifact once that is
published, so we do not vendor the same code twice. Its sha256 is
`5f2e53355baa90ed1fd38ec842a7bf2703276fd4604c2730e6b92d149e203ecf`.

## Updating Vendored Packages

To update a vendored package:

1. For a published version, run `npm pack @langwatch/scenario@<version>` in this
   directory. For an unreleased build, set the prerelease version in the source
   repo's `/javascript/package.json` without committing it, run `pnpm buildpack`
   there (https://github.com/langwatch/scenario) and copy the generated `.tgz`
   here
2. Delete the tarball it replaces, so the directory never holds two builds of
   the same package
3. Update the dependency in `package.json` to point to the new tarball
4. Run `pnpm install` at the repo root to update the lockfile
5. Record the source commit, the version and the sha256 (`shasum -a 256`) above
6. Commit both the tarball and the lockfile changes
