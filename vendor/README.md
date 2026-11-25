# Vendor Directory

Holds a dependency as a tarball only when the workspace needs a build that is
not on npm yet.

No package is vendored at the moment: `@langwatch/scenario` comes from npm,
pinned in the `pnpm-workspace.yaml` catalog and its two `overrides` lines.

## Vendoring an unreleased build

1. In the source repo, set a prerelease version in `/javascript/package.json`
   without committing it, run `pnpm buildpack`, and copy the `.tgz` here.
2. Point the `@langwatch/scenario` catalog entry and the two `overrides` lines
   in `pnpm-workspace.yaml` at `file:./vendor/<tarball>` and its version. Every
   consumer uses `catalog:`, so that is the only edit.
3. `pnpm install`, then commit the tarball and the lockfile together.
4. Once the version is on npm, point those lines back at it and delete the
   tarball, so the same code is not vendored twice.
