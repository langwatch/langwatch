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
- After adding or removing a workspace package: `pnpm sync:references`.
- Nx (ADR-150) infers one project per workspace member and one target per
  script (`pnpm test:all`, `pnpm graph`). Packages resolve each other's source,
  so a dependency's files are inputs to its dependents and the cache is correct
  across packages. `test:integration` is deliberately uncached: it reads
  datastores no input declaration describes.
