---
paths:
  - "**/package.json"
  - "**/tsconfig*.json"
  - "pnpm-workspace.yaml"
  - "nx.json"
---

# Workspace and package configuration

- One `pnpm install` at the root; one lockfile (ADR-076). Declare a new
  dependency and install it (`env -u CI pnpm install --filter "<package>..."`)
  before the first import of it is written.
- Security `overrides` go in the root `pnpm-workspace.yaml`; a `pnpm` block in a
  member `package.json` is silently ignored.
- Every package tsconfig sets `incremental` and its own `tsBuildInfoFile` at
  `dist/tsconfig.<stem>.tsbuildinfo`, beside the output, never under
  `node_modules`.
- A package's `tsconfig.json` is a container: `tsconfig.build.json` emits its
  declarations, `tsconfig.test.json` checks sources and tests (`tsconfig.app.json`
  for a package with no build). After adding or removing a workspace package or
  dependency: `pnpm sync:references` (`nx sync` writes every cross-package
  reference; `pnpm typecheck` runs it first and CI runs `nx sync:check`).
- Nx (ADR-150) infers one project per workspace member and one target per
  script (`pnpm test:all`, `pnpm graph`). At runtime packages resolve each
  other's source (`default` points at `src/`), so a dependency's files are
  inputs to its dependents and the cache is correct across packages. Types
  resolve through the declarations: a published module package maps `types` to
  `dist/index.d.ts`, which is why its installer is the opaque
  `PublishedProcessModule` and why `pnpm sync:references` matters. `test:integration` is deliberately uncached: it reads
  datastores no input declaration describes.
