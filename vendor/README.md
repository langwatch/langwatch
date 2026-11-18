# Vendor Directory

Dependencies that are not on npm, vendored as tarballs so the workspace pins
known bits and can carry an unreleased build when one is needed.

## @langwatch/scenario

**File:** `langwatch-scenario-1.7.1-dev.otel3.tgz`
**sha256:** `09114ce5594e9536d40740b37ac59e935d6461166fdf636056309ea855b08ae2`

An unreleased build of [langwatch/scenario](https://github.com/langwatch/scenario)
at `71626704`: its main after the 1.7.0 release (`50abd232`) plus the move to
OpenTelemetry JS 3.x. It depends on `@opentelemetry/sdk-trace` 3.1.1 instead of
the deprecated `sdk-trace-base` and `sdk-trace-node`, takes `@opentelemetry/api`
`>=1.10.0 <1.11.0`, and accepts `langwatch` up to `<4.0.0`, so it runs beside
this repository's SDK on the same OpenTelemetry. It is stamped as the prerelease
`1.7.1-dev.otel3`; the stamp is set locally before `pnpm buildpack` and is not
committed in the scenario repo, where main stays on its released version.

The voice transports this repository's voice code is written against
(`voice.openTwilioTunnel`, `voice.twilioAgent`), per-criterion judge verdicts on
the run finished event, and the Claude Code watchdog's dash-safe
`kill -TERM "-$child"` are all in that source, so the tarball carries no edit
over the build.

Swap it for the published npm release that carries OpenTelemetry JS 3.x once
that exists, so the same code is not vendored twice.

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
