---
name: feature-move
description: "Move code into its owning LangWatch feature package the lift-and-shift way: a module, a service, a screen, a test or a whole family relocates from wherever it sits (an app, another feature, a shared package) into the right layer folder of the owner, imports are repointed at every consumer, nothing is copied, nothing is re-exported for compatibility, and the moves that silently break things (vi.mock paths, source-reading guards, TS2304 half-reverts, install registries) are swept afterwards. Use this whenever someone says 'move', 'relocate', 'this belongs in <feature>', 'extract into a package', 'lift and shift', 'feature-source-subject fired', 'wrong package', or a lint finding says code claims another feature's subject."
user-invocable: true
argument-hint: "<what to move> -> <feature>/<contract|server|web>/<layer>"
---

# Move code into its owner

Read `.claude/skills/architecture-guide/SKILL.md`. The rules here are the ones the
platform extraction taught the hard way, so follow the order.

## Rules that do not bend

- **Move, never copy.** A second copy for "outside callers" is a wall someone else pays
  for; consumers repoint to the new location in the same change.
- **Never re-export for backwards compatibility.** Update every importer instead.
- **Keep the shape, fix the imports.** Redesign only where a source import has no
  equivalent in the destination (an app alias like `~/` with no package export). Big
  files are a `mv`, not a rewrite.
- **Named absences, not stubs.** If the destination cannot yet reach a collaborator, the
  composition root names the absence; nothing returns fake data.
- **Delete what becomes unreachable** at the source after the move; do not leave a
  hollow module behind.
- **Agents never stage, commit, stash, reset or clean.** Edit files; the orchestrator
  commits path-scoped.

## 1. Map source to destination

For each file, decide the destination folder from the grammar (`references/server.md`,
`references/web.md`, `references/contract.md`). Rename to the canonical filename
(`prisma.<name>.repository.ts`, `<name>.service.ts`, lower-kebab for web). Write the map
down before moving: `from -> to`, one line each; it is the report's spine and the sweep's
checklist.

Pure, framework-free code shared by both halves goes to the contract. A hook or
component goes to the web package. A Prisma read goes into `repositories/prisma/` behind
the abstract repository, never into a service.

## 2. Move

```bash
git mv <from> <to>          # keeps history; plain mv is fine for untracked files
```

Then fix the moved file's own imports: relative paths that broke, `~/` or `@ee/`
aliases to package imports, `#*` self-imports inside a server package.

## 3. Repoint every consumer

```bash
grep -rn "<old path or old module name>" --include=*.ts --include=*.tsx --include=*.mjs --include=*.json --include=*.feature --include=*.md . | grep -v node_modules
```

Fix each importer. Cross-package consumers import from the destination package's public
entry: for a server package that means the service or adapter from `index.ts` (never a
repository); for a web package `./screens/*` or `./surfaces/*`. If a consumer would need
something the entry does not export, that is the redesign seam: expose a service method
or a surface, not the internal module.

## 4. The second-pass sweep (this is where moves break)

Run every item; each has bitten a previous move.

- **`vi.mock` paths**: a `vi.mock("<old path>")` still parses and mocks nothing.
  `grep -rn "vi.mock(" <touched test dirs>` and repoint to the new specifier.
- **Source-reading guards**: tests that `readFileSync` a path by string (boundary scans,
  parity checkers, comment scanners) die with ENOENT or, worse, pass against nothing.
  `grep -rn "readFileSync\|existsSync" packages/architecture-lint apps/*/tests | grep <old dir>`.
- **TS2304 half-reverts**: after moving, `tsc` on every touched package plus `apps/api`,
  `apps/worker`, `apps/ui`. A `TS2304: Cannot find name` means a use survived and its
  declaration moved without an import.
- **Install registries**: `apps/ui/src/features/installed-ui-features.ts`,
  `installed-ui-drawers.ts`, `catalogue.json`, `apps/ui/src/model/ui-route-table.ts`,
  `apps/api/src/app-rest/app-rest.packaged-families.ts`, `apps/worker/src/features/catalogue.json`.
- **Spec citations**: `.feature` files and `AUDIT_MANIFEST.md` that name the old path;
  `@scenario` annotations travel with their tests.
- **Package manifests**: the destination `package.json` gains the dependencies the moved
  code needs; the source loses the ones nothing uses any more; run `pnpm install` once
  (never hand-link into `node_modules`).
- **Ownership**: if the file's subject is another feature's, the move is to that feature;
  `feature-source-subject` will say so.
- **Frontend boundary**: a server file that moved next to something importing React now
  fails `tests/frontend-boundary.unit.test.ts`.

## 5. Gates, scoped

```bash
pnpm --filter <destination pkg> test && pnpm --filter <destination pkg> exec tsc --noEmit -p tsconfig.json
pnpm --filter <each consumer pkg> exec tsc --noEmit -p tsconfig.json
pnpm --filter @langwatch/architecture-lint lint
pnpm --filter @langwatch/architecture-lint exec tsx src/check-feature-parity.ts
pnpm exec oxlint <touched> && pnpm exec oxfmt <touched>
```

## Report

The `from -> to` map; every consumer repointed; each sweep item with what it found;
what was deleted at the source; gate numbers; anything left as a named absence and why.
