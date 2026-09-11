# Manifest: cv2-port-word

Objective: Remove the last `ports/` and `adapters/` directories from the module
tree. Only `modules/gateway` still has them.
Owner: unassigned
Model: sonnet   - the target shape is ruled and the classification rules are
written below. No design decisions, but real per-file judgment.
Budget: 90 tool calls
Depends on: nothing.
Handoff: .claude/handoffs/cv2-port-word.md

## State, measured at a08cbd27b8 plus the working tree

```
HEAD:         43 files   gateway 31, workflow 11, langy 1
working tree: 31 files   gateway only
```

**workflow and langy are already converted in the working tree, uncommitted** -
their `adapters/` became `channels/` and `services/`. Do not redo them, and do
not commit them; they are another lane's staged work. Gateway is what is left.

Re-measure before you start:

```
find modules enterprise/modules -path '*/ports/*.ts' -o -path '*/adapters/*.ts' \
  | grep -v __tests__ | grep -v node_modules | wc -l
```

## Owned paths

```
modules/gateway/server/src/ports/**
modules/gateway/server/src/adapters/**
modules/gateway/server/src/**          only files naming a moved identifier
modules/gateway/contract/src/**        only if a moved type is named there
```

Nothing outside `modules/gateway`.

## Shared paths - stop and request

```
apps/api/src/app/api-production.composition.ts     coordinator
apps/worker/src/app/worker-*.composition.ts        coordinator
packages/architecture-lint/src/*-baseline.json     coordinator
modules/workflow/**, modules/langy/**              another lane's uncommitted work - do not touch
```

## Read-only reference paths

```
modules/workflow/server/src/channels/**     THE EXEMPLAR - the conversion that just landed
modules/workflow/server/src/services/**     where its non-channel adapters went
modules/annotation/server/src/channels/**   the reference shape
.claude/skills/module/references/move.md    the procedure for relocating code
```

`modules/workflow` is the exemplar: it made exactly this move, in this tree, in
the last few hours. Read its `channels/` and `services/` before deciding
anything. Copy what it did.

## Target shape

31 files: 4 under `ports/`, 27 under `adapters/`. They are not one kind of thing,
and the whole task is deciding which each is. A rough first pass by what each
file imports:

| Destination | Roughly | Examples |
| --- | --- | --- |
| `repositories/{prisma,clickhouse}/` behind an interface, with a memory twin and a registry entry | ~20 | `postgres.virtual-key.adapter.ts`, `clickhouse.gateway-open-admissions.adapter.ts`, `prisma.gateway.adapter.ts` |
| `channels/<tier>/` with a memory twin and `defineChannels` | ~1 | `eventing.gateway-spend.adapter.ts` |
| A member of `<F>Infrastructure` the process supplies | a few | `jwt.gateway-token.adapter.ts`, `virtual-key-crypto.adapter.ts` |
| **Nothing special - a plain module or a service** | several | `gateway-budget-dto.adapter.ts`, `gateway-provider-label.adapter.ts`, `gateway-virtual-key-dto.adapter.ts`, `gateway-wire-pagination.adapter.ts` |

That fourth row is the one to get right. A DTO mapper, a label lookup and a
pagination helper are **pure functions**. They were never ports; they were named
`adapter` because the folder was there. They do not become channels, they do not
become repositories, and they do not get an interface and a memory twin. They
become ordinary colocated modules, or methods on the service that uses them.

Forcing a pure function into a repository interface with a memory twin is a
worse outcome than leaving it alone - say so and move it plainly.

Identifiers follow the destination: `XxxPort` becomes `XxxRepository`,
`XxxChannel`, an infrastructure member name, or just the function's own name.

## Batches

Two lane runs, not one. Land the first green before starting the second.

- **Batch A - persistence**: the ~20 postgres/clickhouse/prisma files into
  `repositories/`, each behind an interface with a memory twin, registered in
  `gateway-repositories.registry.ts` with `defineRepositories`.
- **Batch B - the rest**: the eventing channel, the infrastructure members, and
  the pure functions.

## Invariants

- **Behaviour does not change.** Every operation gateway has today it has after.
- Only `repositories/prisma/**` may name `PrismaClient`.
- A live channel gets a memory twin and a registry entry, or it is not done.
- Every identifier goes through `tslsp-cli` - `references --symbol`,
  `rename --symbol --dry-run` then without, `rename-file OLD NEW`,
  `diagnostics --file`. Never grep or sed at this scale.
- After each rename, check by hand for `vi.mock("<path>")` strings and tests that
  read source as text. The language server sees neither.
- No re-export for compatibility. Repoint the importers.
- Do not add a baseline row. If one would be needed, stop and say so.
- No `as unknown as`, no non-null `!`, no `ctx: unknown`.
- British English, no em dashes - write " - " instead.

## Checks

```
VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/gateway-server test:unit
rtk pnpm typecheck:one modules/gateway/server        (once, at the end of the batch)
```

Nothing wider. Then re-run the find above and report the count beside 31.

## Stop conditions

- a shared path is needed;
- a file is none of the four destinations - that is a finding, and the
  coordinator decides;
- the budget is reached. **Land the batch you are on, green, and stop.** A
  half-converted module is worse than an unconverted one.

## Completion criteria

Per batch:

- no `ports/` or `adapters/` directory remains in `modules/gateway` after batch B;
- every moved file is a repository, a channel, an infrastructure member or a
  plain module, and the handoff says which each became and why;
- each live channel and each repository has a memory twin and a registry entry;
- no `*Port` / `*Ports` identifier remains in the module;
- `pnpm --filter @langwatch/gateway-server test:unit` passes and
  `typecheck:one modules/gateway/server` is clean.
