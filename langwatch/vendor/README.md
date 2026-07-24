# Vendor Directory

This directory contains vendored dependencies that are not published to npm.

## Contents

### @langwatch/scenario

**Now consumed from npm, not from this directory.**

The scenario testing SDK is published to npm, so `package.json` depends on a
plain version (`"@langwatch/scenario": "0.4.12"`) rather than a `file:` path
into this directory.

The tarballs here are leftovers from when it was vendored. They are NOT in
version control (`*.tgz` is excluded), so a `file:` specifier pointing at one
cannot be resolved by CI or by a fresh clone: the referenced file simply is not
there. A published version can.

**Source:** https://github.com/langwatch/scenario

## Updating Vendored Packages

To update a vendored package:

1. In the source repo (https://github.com/langwatch/scenario), navigate to the `/javascript` directory and run `pnpm buildpack`
2. Copy the generated `.tgz` file to this directory
3. Update the dependency in `package.json` to point to the new tarball
4. Run `pnpm install` to update the lockfile
5. Commit both the tarball and the lockfile changes
