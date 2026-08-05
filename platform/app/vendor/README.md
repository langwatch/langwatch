# Vendor Directory

This directory contains vendored dependencies that are not published to npm.

## Contents

### @langwatch/scenario

**File:** `langwatch-scenario-1.0.0.tgz`

The scenario testing SDK for LangWatch, vendored as the exact published npm
artifact so the app pins known bits and can also carry unreleased builds when
needed.

**Source:** https://github.com/langwatch/scenario

## Updating Vendored Packages

To update a vendored package:

1. For a published version, run `npm pack @langwatch/scenario@<version>` in this
   directory. For an unreleased build, run `pnpm buildpack` in the source repo's
   `/javascript` directory (https://github.com/langwatch/scenario) and copy the
   generated `.tgz` here
3. Update the dependency in `package.json` to point to the new tarball
4. Run `pnpm install` to update the lockfile
5. Commit both the tarball and the lockfile changes
