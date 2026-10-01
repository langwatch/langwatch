# Vendor Directory

Dependencies that are not on npm, vendored as tarballs so the workspace pins
known bits and can carry an unreleased build when one is needed.

## @langwatch/scenario

**File:** `langwatch-scenario-1.7.0-dev.voice10.tgz`
**sha256:** `1e06a22a6929781b01cf153ac1ef7e4ffe4c6f6f4b85c41a8d9d9adf2e25ddaf`

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

This build sends `inconclusiveCriteria` but not the per-criterion `criteria`
array (status, requirement and reasoning for each criterion) on the run
finished event. The platform already ingests, stores and shows that array
(`specs/scenarios/judge-criterion-verdicts.feature`), and suite runs post their
events through the same `/api/scenario-events` path as any SDK, so bumping to a
scenario release that carries per-criterion verdicts needs no platform change.
Until then the run view derives each criterion from the met, unmet and
inconclusive lists, without reasoning.

The tarball carries one edit over that build, in `dist/index.js` and
`dist/index.mjs`: the Claude Code watchdog kills the child's process group
with `kill -TERM "-$child"` instead of `kill -TERM -- "-$child"`. It runs
under `/bin/sh`, which is dash on Debian and Ubuntu, and dash refuses the
`--` with "Illegal number", so a killed worker left its Claude Code child
running. The same edit is needed in scenario's
`javascript/src/agents/claude-code/process-lifecycle.ts` before the next
build replaces this one.

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
