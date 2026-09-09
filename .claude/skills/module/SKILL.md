---
name: module
description: "Build or change a LangWatch module (modules/<name>/{contract,server,web}), the annotation way: create one from scratch, extend an existing one with a new operation/field/screen/REST endpoint/tRPC procedure, convert a legacy-shaped module to the annotation shape, wire an installed module into apps/api/apps/worker/apps/tasks/apps/ui, move code into its owning module, or publish a piece of a module's web package for another module to mount. Use whenever someone says 'add a module', 'new feature package', 'add a mutation/column/filter/endpoint/procedure', 'make X look like annotation', 'convert X', 'hook it up', 'wire the worker', 'this belongs in X', 'move this into', 'reuse this component in another module', or 'export it from the web package'. One skill, one shape; the task decides which reference you read."
user-invocable: true
argument-hint: "<new|extend|convert|wire|move|web-surface> <module> [details]"
---

# Build or change a module

A **module** is one folder, `modules/<name>/`, owning three workspace
packages: `contract`, `server` and `web`. The word is the same in the tree and in
the identifiers a module author types: `defineModule`, `withModule`, `moduleApi`,
`installApi<Name>`, `<Name>Api`, `ModuleName`.

Read `.claude/skills/architecture-guide/SKILL.md` first, always. It is the map of the
whole shape; this skill is the set of procedures for changing it. `modules/annotation`
is the one module with no entry in `packages/architecture-lint/src/feature-shape-baseline.json`,
the reference every task below copies.

## What are you doing → read which reference

| You are... | Read |
| --- | --- |
| Creating a module that has no package yet | `references/new.md` |
| Adding a capability to a module that already exists: a new operation, field, error, screen section, drawer, REST endpoint or tRPC procedure | `references/extend.md` |
| Bringing a module that still carries legacy pieces (`feature-shape` entries) into the annotation shape | `references/convert.md` |
| Booting an already-built module's installer into a process, mounting a namespace/family, registering it in `apps/ui`/`apps/worker`/`apps/tasks` | `references/wire.md` |
| Relocating code (a service, a screen, a test, a whole family) into its owning module | `references/move.md` |
| Publishing one piece of a module's web package (a component, a store, a host provider) for a *different* module to mount | `references/web-surface.md` |
| Renaming members, repointing imports at a moved export, deriving a web procedure map from a contract, or following an interface with a test double: no behaviour change, tool-proven | `references/remap.md` |

A request often spans two: extending a module with a new REST route that nobody mounts
yet is `extend.md` for the route and `wire.md` for the family. Say which reference covered
which part of the change in the report.

Auditing rather than building? That is `module-review`, a separate skill: read-only, no
edits, evidence-first.

## The shape, in brief

```
modules/<name>/
├── feature.json · specs/ · adrs/
├── contract/src/    <name>.api.ts (interface <Name>Api + moduleApi token), schemas,
│                    errors, <name>.trpc.ts (defineTrpcContract), <name>-rest.schemas.ts
├── server/src/      <name>.server.ts (installer), app/<name>.app.ts (implements <Name>Api),
│                    services/, repositories/{interfaces, prisma/, memory/}, transport/
└── web/src/         flat entry files, model/, behavior/, ui/{elements,blocks,sections}
```

Dependency direction, no exceptions: `apps/ui -> *-web -> *-contract`,
`apps/{api,worker,tasks} -> *-server -> *-contract`. web never imports server; server
never imports web; contract imports no framework and no other half. One peer module talks
to another only through the peer's `*Api` token, named in `static dependencies` and
provided at boot, never through an import of the peer's service or repository.

## Layer order, both halves

**Server** (`server/src`): `transport/*.rest.ts` and `transport/*.trpc.ts` are inert
declarations that call exactly one operation on `app/<name>.app.ts`, the module's one
public object (`implements <Name>Api`, `static contract`, `static dependencies`, private
constructor, `static create(setup)`). The app calls private `services/*.service.ts`
(one class per entity, over a repository interface); a service never sees Prisma, a peer
API or another service. Repositories are interfaces in `repositories/`, a Prisma
implementation in `repositories/prisma/`, a memory twin of the same observable behaviour
in `repositories/memory/`, chosen once at boot by `repositories/<name>-repositories.registry.ts`
(`defineRepositories({ postgres, memory })`). Only `repositories/prisma/**` names Prisma.
Technical infrastructure (encryption, object storage, a clock) is a member of `<F>Infrastructure`,
a plain interface beside the app that the process supplies; no `ports/` or `adapters/` folder,
never a peer module. `index.ts` exports the installer and the transport declarations, nothing
runtime.

**Web** (`web/src`): `model` (pure values, the `*HostPort` contract) → `behavior` (hooks,
the api binding) → `ui/elements` → `ui/blocks` → `ui/sections` (data meets layout), with
flat public entry files at `src/<id>.ts` listed in `package.json` `exports` and declared
in `apps/ui/src/features/catalogue.json`. Elements and blocks never import behavior.

Full detail for each layer: `.claude/skills/architecture-guide/references/{contract,server,web,config-composition,install,testing}.md`.

## What a lane may and may not do

- **Lift and shift, not redesign.** Every operation, error code, query and screen a
  module has today it still has after; a redesign is a separate change once the shape is
  right.
- **Never re-export for backwards compatibility.** Update every importer instead.
- **Read before you delete.** `git diff` and read every file in a directory before `rm`.
- **`mv`, not `git mv`.** Lanes never stage, commit, stash, reset or clean; a moved file
  goes with plain `mv`, the root session owns the index.
- **No re-exports, no `as unknown as`, no `as PrismaClient`, no `try*`/`require*` methods,
  no optional collaborator a process always supplies, no `process.env` below the
  entrypoint.**
- **Named absences, not stubs.** If a dependency genuinely is not there yet, the
  composition root names it; nothing returns fake data. Do not invent a `refusing<F>Feature()`
  twin, an `Unavailable*` error or a `Logged*Absence` for new work (ADR-133 retires the
  shape): a process installs a module or it does not.
- **The spec wins.** If the changed code answers differently from a bound scenario, the
  code is wrong; fix the code, never the assertion.
- **Sabotage once per moved or new behaviour.** Break it, watch the right test fail for
  the right reason, restore. An unchanged test result after sabotage is not evidence;
  say so.
- **Never run the root `pnpm typecheck`, `pnpm lint --fix` or `pnpm format`.** Scope every
  check to the packages you touched (`references/new.md`'s gates section, or
  `.claude/skills/architecture-guide/references/gates.md` directly).
- **Never boot `pnpm dev` to verify a change.** The installation and composition
  integration tests are the proof.

## The exit bar

- `packages/architecture-lint/src/feature-shape-baseline.json` gains no new entry for the
  module you touched (a brand-new module gets zero entries, ever).
- `pnpm --filter @langwatch/architecture-lint lint` shows no new violation in the files
  you touched (baselined, pre-existing ones are not yours to fix unless you touched that
  file).
- `pnpm --filter @langwatch/architecture-lint check:feature-parity` reports every scenario
  you added or touched as bound; read the `✗ THIS RUN FAILS: …` banner, not a per-file `✓`.
- Every package you touched passes its own `typecheck` and `test`.
- No re-export, no `refusing*` twin, no widened `.strict()` schema, no message-prose
  assertion left behind.

## Report shape

Every reference below ends with its own report shape (scenario titles and their binding
tests, files touched per layer, error codes added, gate numbers, anything left absent by
design). When a change spans more than one reference, say which reference covered which
part, in the order you worked them.
