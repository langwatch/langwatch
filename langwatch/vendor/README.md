# Vendor Directory

This directory contains vendored dependencies that are not published to npm.

## Contents

### @langwatch/scenario

**File:** `langwatch-scenario-0.4.0.tgz`

The scenario testing SDK for LangWatch. This is vendored here instead of being
published to npm to allow faster iteration during development.

**Source:** https://github.com/langwatch/scenario

## Updating Vendored Packages

To update a vendored package:

1. In the source repo (e.g., scenario-ts), run `pnpm pack`
2. Copy the generated `.tgz` file to this directory
3. Update the dependency in `package.json` to point to the new tarball
4. Run `pnpm install` to update the lockfile
5. Commit both the tarball and the lockfile changes
