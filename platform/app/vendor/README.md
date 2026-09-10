# Vendor Directory

This directory contains vendored dependencies that are not published to npm.

## Contents

### @langwatch/scenario

**File:** `langwatch-scenario-1.7.0-dev.voice2.tgz`

The scenario testing SDK for LangWatch, vendored as a tarball so the app pins
known bits and can also carry unreleased builds when needed.

**Source:** https://github.com/langwatch/scenario

**Current build:** This is an unreleased build of langwatch/scenario at commit
29dea33, carrying the voice work from scenario PR #982. It is stamped as the
prerelease `1.7.0-dev.29dea33`. Swap it for the real npm 1.7.0 artifact once
that is published, so we do not vendor the same code twice. Its sha256 is
`b5bb239b3ec6cd0860a97851359e6f7048dd1b6a479ff991d1457cfc92bdcfd5`.

## Updating Vendored Packages

To update a vendored package:

1. For a published version, run `npm pack @langwatch/scenario@<version>` in this
   directory. For an unreleased build, run `pnpm buildpack` in the source repo's
   `/javascript` directory (https://github.com/langwatch/scenario) and copy the
   generated `.tgz` here
3. Update the dependency in `package.json` to point to the new tarball
4. Run `pnpm install` to update the lockfile
5. Commit both the tarball and the lockfile changes
