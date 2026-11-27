# Vendor Directory

Holds a dependency as a tarball only when the workspace needs a build that is
not on npm yet.

Vendored now: `langwatch-scenario-1.8.2-dev.otel3.tgz`
(sha256 `f4c19138904e588db45b2d3715b222ce23a510dec3e674c31039ea9a877647f9`),
scenario 1.8.1 moved to OpenTelemetry JS 3.x (langwatch/scenario#1059 at
`ea55a83e`). Published 1.8.1 still runs OpenTelemetry JS 2.x, which cannot
share a process with this repository's SDK. Point back at npm once that PR
ships.

## Vendoring an unreleased build

1. In the source repo, set a prerelease version in `/javascript/package.json`
   without committing it, run `pnpm buildpack`, and copy the `.tgz` here.
2. Point the `@langwatch/scenario` catalog entry and the two `overrides` lines
   in `pnpm-workspace.yaml` at `file:./vendor/<tarball>` and its version. Every
   consumer uses `catalog:`, so that is the only edit.
3. `pnpm install`, then commit the tarball and the lockfile together.
4. Once the version is on npm, point those lines back at it and delete the
   tarball, so the same code is not vendored twice.
