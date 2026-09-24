# Vendor Directory

Dependencies that are not on npm, vendored as tarballs so the workspace pins
known bits and can carry an unreleased build when one is needed.

## @langwatch/scenario

**File:** `langwatch-scenario-1.7.0-dev.voice10.tgz`
**sha256:** `5f2e53355baa90ed1fd38ec842a7bf2703276fd4604c2730e6b92d149e203ecf`

An unreleased build of [langwatch/scenario](https://github.com/langwatch/scenario)
at `55de2020`, which is its main with scenario PR #1001 merged: the judge maps
each criterion by its schema key rather than by position, reports inconclusive
criteria apart from unmet ones, waits out a quiet period before a trace counts
as settled, and retries an empty user-simulator answer. It is stamped as the
prerelease `1.7.0-dev.voice10`; the stamp is set locally before `pnpm buildpack`
and is not committed in the scenario repo, where main stays on its released
version.

It is the build this repository's voice code is written against: the voice
transports read `voice.openTwilioTunnel` and `voice.twilioAgent` off the SDK's
`voice` namespace.

Swap it for the published npm 1.7.0 once that exists, so the same code is not
vendored twice.

## Updating

1. Published version: `npm pack @langwatch/scenario@<version>` here.
   Unreleased: set the prerelease version in the source repo's
   `/javascript/package.json` without committing it, run `pnpm buildpack` there,
   and copy the `.tgz` here.
2. Delete the tarball it replaces, so the directory never holds two builds of
   the same package.
3. Point the `@langwatch/scenario` catalog entry and the two `overrides` lines in
   `pnpm-workspace.yaml` at the new file and version - every consumer uses
   `catalog:`, so that is the only edit.
4. `pnpm install`, then commit the tarball and the lockfile together.
