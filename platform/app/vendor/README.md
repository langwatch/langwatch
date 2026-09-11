# Vendor Directory

This directory contains vendored dependencies that are not published to npm.

## Contents

### @langwatch/scenario

**File:** `langwatch-scenario-1.7.0-dev.voice4.tgz`

The scenario testing SDK for LangWatch, vendored as a tarball so the app pins
known bits and can also carry unreleased builds when needed.

**Source:** https://github.com/langwatch/scenario

**Current build:** This is an unreleased build of langwatch/scenario at commit
70c6a291, carrying the voice work from scenario PR #989. It is stamped as the
prerelease `1.7.0-dev.voice4`. Swap it for the real npm 1.7.0 artifact once
that is published, so we do not vendor the same code twice. Its sha256 is
`e7df1c32a93131ea823b33ef29020231ba1eeed727174056e61fd6b954e78db0`.

## Updating Vendored Packages

To update a vendored package:

1. For a published version, run `npm pack @langwatch/scenario@<version>` in this
   directory. For an unreleased build, run `pnpm buildpack` in the source repo's
   `/javascript` directory (https://github.com/langwatch/scenario) and copy the
   generated `.tgz` here
3. Update the dependency in `package.json` to point to the new tarball
4. Run `pnpm install` to update the lockfile
5. Commit both the tarball and the lockfile changes
