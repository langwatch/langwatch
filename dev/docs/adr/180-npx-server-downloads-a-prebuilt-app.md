# ADR-180: `npx @langwatch/server` downloads a prebuilt app per platform

**Date:** 2026-10-19

**Status:** Accepted

## Context

`npx @langwatch/server` ships most of the repository as source inside the npm package
(`apps/server/distribution-files.json`). On first run the CLI copies that tree to
`~/.langwatch/app`, installs it with dev dependencies, runs `build:server` if the build output
is missing, installs a second time to strip dev dependencies, generates the Prisma client and
relinks shared dependencies (`apps/server/src/services/node-deps.ts`, `app-dir.ts`). The publish
job already runs `build:server` before packing, so the user's machine pays for the dev-dependency
install and the prune without needing either.

The machinery carries workarounds that exist only because of this layout: recreating the `.npmrc`
npm strips, restoring the executable bit npm drops, versioned install keys, interrupted-install
checks, relinking member peers, and shipping the `package.json` of dev-only workspace members so a
frozen install resolves.

The production image already has the recipe for a runtime-only tree (`infra/docker/Dockerfile`,
builder stage): build, drop every `node_modules`, install production dependencies with the image
pnpmfile, remove browser halves, tests and maps, then check every link resolves.

## Decision

1. The publish workflow builds one **app archive per platform** (`linux-x64`, `linux-arm64`,
   `darwin-x64`, `darwin-arm64`), each on a runner of that platform so native dependencies match.
   Each archive is the runtime-only tree the image builds, plus the Python sources `uv` needs
   (langevals, the Python SDK), with its production `node_modules` and generated files in place.
2. The runtime-only recipe lives in one script that both the Dockerfile and the archive job run,
   so the image and the npx install cannot drift.
3. Each archive and its SHA-256 file are attached to the GitHub release `v<version>`, beside the
   AI gateway binaries, under the same platform slugs (`amd64`, `arm64`).
4. The npm package is the CLI only: `dist/cli.cjs`, `package.json`, `README.md`, `LICENSE.md`.
5. On start, the CLI's `app` predep installs the archive for its own version into
   `~/.langwatch/app/<version>/`: download, verify the checksum, extract beside the target,
   rename into place, then remove other versions. A tree without its completion marker is
   downloaded again. No pnpm install and no build runs on the user's machine.
6. Run from a checkout (`pnpm dev:cli`), the CLI keeps using the checkout in place.
   `LANGWATCH_APP_ARCHIVE` (a file path or URL, through the local-orchestrator config) points the
   predep at a locally built archive; the smoke workflow boots through it.
7. The CLI refuses Node older than 24 (the backend's own floor) and Linux on musl, each with a
   message naming what to use instead.

## Consequences

- First run is a download and an extract; the slowest and most fragile steps leave the user's
  machine. Python environments are still prepared locally by `uv`, unchanged.
- Each archive also carries the tokenizer files the image fetches at build (`tiktoken/` for the
  app, `tiktoken-python/` for LangEvals), so a first start downloads none.
- The relocation copy, both installs, the peer relinking, the `.npmrc` and executable-bit
  repairs, the install keys and `distribution-files.json` are deleted.
- A release now needs four archive builds before npm publish; a missing archive fails publish
  rather than every user's first run.
- An install made by an older CLI (a flat `~/.langwatch/app`) is replaced on first start; data
  under `~/.langwatch/data` is untouched.
