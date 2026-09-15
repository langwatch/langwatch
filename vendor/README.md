# Vendor Directory

Dependencies that are not on npm, vendored as tarballs so the workspace pins
known bits and can carry an unreleased build when one is needed.

## @langwatch/scenario

**File:** `langwatch-scenario-1.7.0-dev.voice7.tgz`
**sha256:** `d0adcf874ec0ff8396253f396a43b3313b9eb1093c011561c2f5ee20630169b7`

An unreleased build of [langwatch/scenario](https://github.com/langwatch/scenario)
carrying the voice work, taken byte-for-byte from `origin/main`
(`platform/app/vendor/`) when the monolith that held it was deleted.

It is the build this repository's voice code is written against: the voice
transports read `voice.openTwilioTunnel` and `voice.twilioAgent` off the SDK's
`voice` namespace, and this artifact exports both.

> **The filename and the version inside it disagree.** The file says `voice7`;
> `package/package.json` inside declares **`1.7.0-dev.voice6`**. That mismatch
> came with the artifact - it is what `origin/main` pinned as `voice7` - and
> pnpm will resolve it as `1.7.0-dev.voice6`. The sha256 above is what
> identifies this build, not the name.
>
> The sibling `voice4` tarball in main was self-consistent (`1.7.0-dev.voice4`),
> so this is specific to the voice7 artifact.

Swap it for the published npm 1.7.0 once that exists, so the same code is not
vendored twice.

## Updating

1. Published version: `npm pack @langwatch/scenario@<version>` here.
   Unreleased: `pnpm buildpack` in the source repo's `/javascript`, copy the
   `.tgz` here.
2. Point the `@langwatch/scenario` catalog entry in `pnpm-workspace.yaml` at the
   new file - every consumer uses `catalog:`, so that is the only edit.
3. `pnpm install`, then commit the tarball and the lockfile together.
