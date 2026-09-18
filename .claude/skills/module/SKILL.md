---
name: module
description: "Build or change a LangWatch module (modules/<name>/{contract,process,browser,browser-kit}), the annotation way: create one from scratch, extend an existing one with a new operation/field/screen/REST endpoint/tRPC procedure, convert a legacy-shaped module to the target shape, wire an installed module into apps/api/apps/worker/apps/tasks/apps/ui, move code into its owning module, or publish a piece of a module's browser package as a kit for another module to mount. Use whenever someone says 'add a module', 'new feature package', 'add a mutation/column/filter/endpoint/procedure', 'make X look like annotation', 'convert X', 'hook it up', 'wire the worker', 'this belongs in X', 'move this into', 'reuse this component in another module', or 'export it as a kit'. One skill, one shape; the task decides which reference you read."
user-invocable: true
argument-hint: "<new|extend|convert|wire|move|web-surface> <module> [details]"
---

# Build or change a module

A **module** is one folder, `modules/<name>/`, owning up to four workspace
packages: `contract`, `process`, `browser`, `browser-kit`. Read
`dev/docs/ARCHITECTURE.md` §§3-9 first, always — it is the one record; this
skill is only the set of procedures for changing what it describes.
`modules/annotation` is the shape reference every task below copies.

**The tree is mid-rename (record §16).** `modules/annotation` and most other
modules on disk today still spell this `server`/`web`, `defineServerModule`,
`<Name>App` + `.withApp(...)`, per-store `with*` calls. This skill teaches the
**target** column only: `process`/`browser`, `defineProcessModule`,
`<Name>Module` + `.withApi(...)`, `.withStores(stores)`. When you copy a file
from the tree, translate it through record §16's table as you go — never write
the "Today" spelling in new code, and never invent a third spelling of your
own for something §16 already names.

## What are you doing → read which reference

| You are... | Read |
| --- | --- |
| Creating a module that has no package yet | `references/new.md` |
| Adding a capability to a module that already exists: a new operation, field, error, screen section or drawer | `references/extend.md` |
| Adding a REST endpoint or a tRPC procedure to a module that already exists | `references/transport.md` |
| Bringing a module that still carries legacy pieces (`feature-shape` entries) into the target shape | `references/convert.md` |
| Booting an already-built module's installer into a process, or registering its browser half in `apps/ui` | `references/wire.md` |
| Relocating code (a service, a screen, a test, a whole family) into its owning module | `references/move.md` |
| Publishing one piece of a module's browser package (a component, a store, a hook) for a *different* module to mount | `references/web-surface.md` |
| Renaming members, repointing imports at a moved export, deriving a browser procedure map from a contract, or following an interface with a test double: no behaviour change, tool-proven | `references/remap.md` |

A request often spans two: extending a module with a new REST route that
nobody mounts yet is `extend.md` for the route and `wire.md` for the catalogue
entry. Say which reference covered which part of the change in the report.

Auditing rather than building? That is `module-review`, a separate skill:
read-only, no edits, evidence-first.

## The shape, in brief

```
modules/<name>/
├── feature.json · specs/ · adrs/
├── contract/src/      <name>.api.ts (interface <Name>Api + moduleApi token),
│                      schemas, errors, <name>.trpc.ts (defineTrpcContract),
│                      <name>-rest.schemas.ts, <name>.config.ts (§6)
├── process/src/       <name>.module.ts (defineProcessModule installer +
│                      <Name>Module, the class implementing <Name>Api via
│                      .withApi(...)), services/, repositories/{interfaces,
│                      prisma/, memory/}, channels/, eventing/, transport/, rules/
├── browser/src/       PRIVATE — flat entry files, model/, behavior/,
│                      ui/{elements,blocks,sections}
└── browser-kit/src/   the ONLY thing another module's browser half may import
```

Dependency direction, no exceptions: apps → `*-process`/`*-browser` →
`*-contract`; a kit is a leaf any browser package may import (record §3.4).
Contract imports no framework and no other half. `*-process` never imports
`*-browser`; `*-browser` never imports `*-process`. Another module imports
only the owner's **contract** and names the owner's `*Api` token in
`static dependencies`; nobody imports another module's service, repository,
or browser package.

## Layer order, both halves

**Process** (`process/src`): `transport/*.rest.ts` and `transport/*.trpc.ts`
are inert declarations that call exactly one operation on `<Name>Module`, the
module's one public class (`implements <Name>Api`, `static contract`,
`static dependencies`, private constructor, `static create(setup)`).
`<Name>Module` calls private `services/*.service.ts` (one class per entity,
over a repository interface); a service never sees a raw client, a peer API
or another service. Repositories are interfaces in `repositories/`, a Prisma
implementation in `repositories/prisma/`, a memory twin of the same
observable behaviour in `repositories/memory/`, chosen once at boot by
`repositories/<name>-repositories.registry.ts` (`defineRepositories({ live,
memory })`) — the live factory receives whatever raw clients it needs
(`live.create({ prisma, clickhouse, encryption })`); only
`repositories/prisma/**` names Prisma. Messages to or from something the
module does not own (bus, Redis pub/sub, a vendor over HTTP, a queue, email,
Slack, SSE) are a `channels/` interface with per-tier implementations and a
memory twin, never a service member. `index.ts` exports the installer and the
transport declarations, nothing else. Full detail: record §3.2, §3.3.

**Browser** (`browser/src`): `model` (pure values, the `*HostApi` contract) →
`behavior` (hooks, the api binding, stores) → `ui/elements` → `ui/blocks` →
`ui/sections` (data meets layout), with flat public entry files at
`src/<id>.ts` and one declaration file exported at `./declaration`
(`defineBrowserModule` — screens, drawers, publications, mounts, flags). The
generated `browserModules` list installs it. Elements and blocks never
import behavior, and never fetch. A screen reads no session or router
directly: it declares a `*HostApi` the shell implements from
`@langwatch/browser-host` capabilities. Full detail: record §3.4, §10.

## What a module may demand — the four-way rule (record §3.3)

A module cannot build what needs process information, because it does not
have it. Every dependency resolves into exactly one of:

1. **Derivable from supplied stores, no extra info** → a repository or
   channel inside the module. No demand exists.
2. **Another module's capability** → a peer: the `*Api` token in
   `static dependencies`, resolved by the process. A peer is never a member.
3. **A deployment fact** (signing key, base URL, admin list) → the module's
   own declared config schema (§6); the process values the slice. Module
   code never reads `process.env`.
4. **An availability decision** (a capability this deployment may not have)
   → a declared supply token the process answers with one `.provide({...})`
   line. A module never defaults its own availability.

If what you are building does not fit one of these four, it is an
architecture decision — stop and say so rather than inventing a fifth path
(a `ports/` folder, an optional constructor argument, a `refusing*` twin).

## The kit law (record §3.4), when publishing for another module

1. A module's `*-browser` package is closed — nothing else ever imports it.
2. A kit is a leaf: it may import contracts, `design-system` and
   `browser-host`; it may not import its own module's `*-browser`, any other
   `*-browser`, or another kit.
3. A kit fetches nothing — no project-scoped queries, no `browser-trpc`.
   Presentational components and pure hooks only; each consumer wires its
   own data.
4. A kit is a package, not a subpath.
5. A kit exists only where sharing is real — three or more consumers. One
   consumer is bilateral coupling: inline or duplicate it instead.

## What a lane may and may not do

The operating rules — scoped checks, no git writes, no secret reads, owned
paths, cost discipline — are canonical in `.claude/skills/core/repository-rules.md`
and `.claude/skills/core/testing-rules.md`, and are not restated here. What
follows is specific to changing a module.

- **Lift and shift, not redesign.** Every operation, error code, query and
  screen a module has today it still has after; a redesign is a separate
  change once the shape is right.
- **Never re-export for backwards compatibility.** Update every importer.
- **Read before you delete.** `git diff` and read every file in a directory
  before `rm`.
- **`mv`, not `git mv`.** A moved file goes with plain `mv` — the root
  session owns the index, and a lane makes no git write at all.
- **An implementation never sees a raw client.** No Prisma, Redis or
  ClickHouse client in `<Name>Module` or a `services/*.service.ts`; a raw
  client crosses into a module only inside a registry or channel factory's
  `create(members)`.
- **No re-exports, no `as unknown as`, no `as never`, no `as PrismaClient`,
  no non-null `!`, no `ctx: unknown`, no `try*`/`require*` methods, no
  optional collaborator a process always supplies, no `process.env` below
  the entrypoint, folders at most twelve files, no file under twenty lines.**
- **Named absences, not stubs.** If a dependency genuinely is not there yet,
  the process's `.provide({...})` line names it (case 4 above); nothing
  returns fake data. Do not invent a `refusing<F>Feature()` twin, an
  `Unavailable*` error or a `Logged*Absence` for new work — a process
  installs a module or it does not (record §15).
- **The spec wins.** If the changed code answers differently from a bound
  scenario, the code is wrong; fix the code, never the assertion.
- **Sabotage once per moved or new behaviour.** Break it, watch the right
  test fail for the right reason, restore. An unchanged test result after
  sabotage is not evidence; say so.
- **Never boot `pnpm dev` to verify a change.** The installation and
  composition integration tests are the proof (record §13).

## The exit bar

- `packages/architecture-enforcer/src/feature-shape-baseline.json` gains no
  new entry for the module you touched (a brand-new module gets zero
  entries, ever).
- `pnpm --filter @langwatch/architecture-enforcer lint` shows no new
  violation in the files you touched (baselined, pre-existing ones are not
  yours to fix unless you touched that file).
- `pnpm --filter @langwatch/architecture-enforcer check:feature-parity`
  reports every scenario you added or touched as bound; read the
  `✗ THIS RUN FAILS: …` banner, not a per-file `✓`.
- Every package you touched passes its own `typecheck` and `test`.
- No re-export, no `refusing*` twin, no widened `.strict()` schema, no
  message-prose assertion left behind, no spelling from record §15.

## Report shape

Every reference below ends with its own report shape (scenario titles and
their binding tests, files touched per layer, error codes added, gate
numbers, anything left absent by design). When a change spans more than one
reference, say which reference covered which part, in the order you worked
them.
