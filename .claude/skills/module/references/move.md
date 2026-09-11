# Move code into its owning module

Read `.claude/skills/architecture-guide/SKILL.md`. Follow the order; the sweep in step 4
is where moves break.

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
- **Agents never stage, commit, stash, reset or clean.** Edit and move files; the root
  session commits path-scoped.

## 1. Map source to destination

For each file, decide the destination folder from the grammar (`references/server.md`,
`references/web.md`, `references/contract.md`, all under `architecture-guide`). Rename to
the canonical filename (`prisma.<name>.repository.ts`, `<name>.service.ts`, lower-kebab
for web). Write the map down before moving: `from -> to`, one line each; it is the
report's spine and the sweep's checklist.

Pure, framework-free code shared by both halves goes to the contract. A hook or
component goes to the web package. A Prisma read goes into `repositories/prisma/` behind
the repository interface (with its memory twin under `repositories/memory/`), never into a
service. Nothing moves INTO a legacy piece: not into `adapters/`, `fixtures/`, `testing.ts`,
a `transport/<surface>/` folder or a contract `.service.ts` (`feature-shape`); if the
destination module has only those, create the annotation-shaped home.

## 2. Move

```bash
mv <from> <to>
```

Plain `mv` only. A git-level move stages the file, and the root session owns staging.

Then fix the moved file's own imports: relative paths that broke, `~/` or `@ee/`
aliases to package imports, `#*` self-imports inside a server package.

## 3. Repoint every consumer

```bash
grep -rn "<old path or old module name>" --include=*.ts --include=*.tsx --include=*.mjs --include=*.json --include=*.feature --include=*.md . | grep -v node_modules
```

Fix each importer. Cross-package consumers import from the destination package's public
entry: for a server package that means nothing but the installer and transport
declarations: a peer module calls it through its `*Api` token, never an import; for a
web package a declared flat entry (or `./screens/*` / `./surfaces/*`). If a consumer would
need something the entry does not export, that is the redesign seam: add an operation to
the `<F>Api`, or publish a surface (`references/web-surface.md`), not the internal module.

## 4. The second-pass sweep (this is where moves break)

Run every item; each has bitten a previous move.

- **`vi.mock` paths**: a `vi.mock("<old path>")` still parses and mocks nothing.
  `grep -rn "vi.mock(" <touched test dirs>` and repoint to the new specifier.
- **Source-reading guards**: tests that `readFileSync` a path by string (boundary scans,
  parity checkers, comment scanners) die with ENOENT or, worse, pass against nothing.
  `grep -rn "readFileSync\|existsSync" packages/architecture-enforcer/src packages/architecture-enforcer/tests apps/*/tests | grep <old dir>`.
  Path lists inside data files count too: `packages/architecture-enforcer/src/comment-block-roots.json`
  and every `packages/architecture-enforcer/src/*-baseline.json` (one shape, keyed rows; see
  `packages/architecture-enforcer/README.md`).
- **TS2304 half-reverts**: after moving, `pnpm --filter <pkg> typecheck` on every touched
  package plus `@langwatch/platform-api`, `@langwatch/worker`, `@langwatch/ui`. A
  `TS2304: Cannot find name` means a use survived and its declaration moved without an
  import.
- **Install registries**: `apps/ui/src/features/installed-ui-features.ts`,
  `apps/ui/src/features/catalogue.json`, `apps/ui/src/model/ui-route-table.ts`,
  `apps/api/src/app-trpc/app-trpc.features.ts`,
  `apps/api/src/app-rest/app-rest.packaged-families.ts`,
  `apps/worker/src/features/catalogue.json`, `apps/tasks/src/tasks.catalogue.ts`,
  the root `feature-map.json`.
- **Spec citations**: `.feature` files and ADRs that name the old path; `@scenario`
  annotations travel with their tests, and a renamed scenario title breaks its binding.
- **Package manifests**: the destination `package.json` gains the dependencies the moved
  code needs; the source loses the ones nothing uses any more; run `pnpm install` once
  (never hand-link into `node_modules`).
- **Ownership**: if the file's subject is another module's, the move is to that module;
  `feature-source-subject` will say so.
- **Frontend boundary**: a server file that moved next to something importing React now
  fails `tests/frontend-boundary.unit.test.ts`.

## 5. Gates, scoped

```bash
pnpm --filter <destination pkg> test && pnpm --filter <destination pkg> typecheck
pnpm --filter <each consumer pkg> typecheck
```

then the rest of `.claude/skills/architecture-guide/references/gates.md`. Diff the lint
violation LIST before and after, not just the total: a wrong placement trades one
violation for another.

## Report

The `from -> to` map; every consumer repointed; each sweep item with what it found;
what was deleted at the source; gate numbers; anything left as a named absence and why.
