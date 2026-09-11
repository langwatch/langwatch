# Handoff: cv2-port-word

Status: partial
Manifest: .claude/manifests/cv2-port-word.md
Updated: 2026-09-11 14:00

## 1. Identity

cv2-port-word, first lane, attempt 1. Batch A only (persistence), as instructed.
Batch B (channel, infra members, pure functions) is untouched and is a later lane.

## 2. Objective

Clear `ports/`/`adapters/` from `modules/gateway`. This run did Batch A:
persistence files into `repositories/`, each behind an interface with a memory
twin, registered via `defineRepositories`.

## 3. Owned paths

modules/gateway/server/src/ports/**, modules/gateway/server/src/adapters/**,
modules/gateway/server/src/** (only files naming a moved identifier),
modules/gateway/contract/src/** (only if a moved type is named there).

## 4. Shared paths - do not edit

apps/api/src/app/api-production.composition.ts, apps/worker/src/app/worker-*.composition.ts,
packages/architecture-lint/src/*-baseline.json, modules/workflow/**, modules/langy/**.
None were touched.

## 5. Work completed

- Deleted 5 adapter files that were pure re-export binders around repositories
  that already existed (no direct Prisma/ClickHouse calls of their own):
  `gateway-budget-ledger.adapter.ts`, `gateway-spend-events-clickhouse.adapter.ts`,
  `postgres.gateway-trace-destination-report.adapter.ts`,
  `postgres.gateway-virtual-key-config-backfill.adapter.ts`, and
  `gateway-virtual-key-spend.adapter.ts` (this one had zero consumers anywhere
  in the repo - deleted outright). The first four are re-exported from
  `index.ts`/`testing.ts` as aliases of the real repository class
  (`export { GatewayBudgetClickHouseRepository as GatewayBudgetLedgerAdapter }`
  etc.), so every external caller (`apps/worker/src/app/worker-gateway-spend.composition.ts`,
  `worker-governance-ingestion.composition.ts`, `apps/tasks/src/tasks.catalogue.ts`,
  `enterprise/modules/governance/server/src/__tests__/pulled-usage-ledger.integration.test.ts`)
  keeps working unchanged - verified with `tslsp-cli diagnostics` from each of
  those packages, all clean.
- Moved `ports/gateway-internal-store.port.ts` -> `repositories/gateway-internal-store.repository.ts`
  (the `GatewayInternalStore` interface) via `tslsp-cli rename-file` (4 importers
  auto-updated).
- Moved `adapters/postgres.gateway-internal-store.adapter.ts` ->
  `repositories/prisma/prisma.gateway-internal-store.repository.ts` and renamed
  `PrismaGatewayInternalStoreAdapter` -> `PrismaGatewayInternalStoreRepository`
  via `tslsp-cli rename-file` + `rename --symbol` (4 files auto-updated: index.ts
  and two integration test files).
- Added `repositories/memory/memory.gateway-internal-store.repository.ts`
  (`MemoryGatewayInternalStoreRepository`, seedable via `.create(seed)`).
  Compiles clean, exported from `index.ts`. **Not yet in a registry** - see
  Risks.
- Checked every renamed/moved path by hand for `vi.mock("...")` strings: none
  found.

## 6. Files changed

modules/gateway/server/src:
- deleted: adapters/gateway-budget-ledger.adapter.ts, adapters/gateway-spend-events-clickhouse.adapter.ts,
  adapters/gateway-virtual-key-spend.adapter.ts, adapters/postgres.gateway-trace-destination-report.adapter.ts,
  adapters/postgres.gateway-virtual-key-config-backfill.adapter.ts, ports/gateway-internal-store.port.ts,
  adapters/postgres.gateway-internal-store.adapter.ts (moved, see below)
- added: repositories/gateway-internal-store.repository.ts,
  repositories/prisma/prisma.gateway-internal-store.repository.ts,
  repositories/memory/memory.gateway-internal-store.repository.ts
- modified: index.ts, testing.ts, transport/gateway-internal.rest.ts (import path only, via tslsp),
  transport/__tests__/gateway-internal-config-route.integration.test.ts,
  transport/__tests__/gateway-internal-spend-ingest.integration.test.ts,
  transport/__tests__/gateway-internal.rest.integration.test.ts (import paths only, via tslsp)

## 7. Checks completed

VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/gateway-server test:unit -> 47 files, 350 tests, all passed
rtk pnpm typecheck:one modules/gateway/server -> FAILS, but on a pre-existing,
  unrelated error (see section 8) - not on any file this lane touched
find modules enterprise/modules -path '*/ports/*.ts' -o -path '*/adapters/*.ts' | grep -v __tests__ | grep -v node_modules | wc -l -> 24 (was 31)

## 8. Current failure

`typecheck:one modules/gateway/server` fails with 8 TS errors, all in
`packages/runtime-composition/src/feature-installer.ts` (duplicate identifier
`Name`, type-parameter ordering). `git status` shows that file modified,
uncommitted, by another session - not by this lane, and not importable from
anything I added (I reverted the one thing that would have pulled in
`defineRepositories`; see Risks). gateway/server already depended on
`@langwatch/runtime-composition` before this lane touched anything
(`gateway.server.ts`, `app/gateway.app.ts`, two transport files). This is an
external blocker, not a regression from this batch.

## 9. Exact next action

Wait for `packages/runtime-composition/src/feature-installer.ts` to be fixed by
its own session (or ask the coordinator), then re-run
`rtk pnpm typecheck:one modules/gateway/server` to confirm clean. Then a second
Batch A lane should read section 12 below and continue with
`postgres.gateway-spend-scope.adapter.ts` next - it is the cleanest remaining
persistence file (single Prisma-backed class, no port to split first).

## 10. Shared-file requests

none

## 11. Risks

- **`GatewayInternalStore`/`GatewayOpenAdmissions`/`GatewaySpendEvents`/`GatewayVirtualKeys`
  are `abstract class`, not `interface`.** Every other repository in this repo
  (annotation, workflow, dashboard, and gateway's own existing 17
  `repositories/*.repository.ts` files) uses `interface X` +
  `class PrismaX extends PrismaRepository.transactionalFor(...) implements X`.
  `prismaRepositories()` (the helper `defineRepositories` needs) requires every
  repo class to extend `PrismaRepository.for()`/`.transactionalFor()`, which is
  impossible while the repo also `extends` an abstract-class port (TS has no
  multiple inheritance). I tried wiring `GatewayInternalStore` into a
  `gateway-repositories.registry.ts` and it broke at runtime
  (`TypeError: Cannot read properties of undefined (reading 'store')` inside
  `prismaRepositories`, because `PrismaGatewayInternalStoreRepository` has no
  static `.tables`). I reverted the registry/bundle files rather than land it
  broken - `test:unit` is back to green. **This blocks a registry entry for any
  of the four ports**, not just internal-store, and converting all four from
  `abstract class` to `interface` (repointing every `extends` to `implements`)
  is real per-file work the next Batch A lane should do first, before
  attempting another registry.
- Pre-existing gap, not introduced by this lane: gateway's existing 17
  `repositories/*.repository.ts` files (from before this task) have no memory
  twins and no registry either. Manifest scoped Batch A to the files that were
  in `ports/`/`adapters/`; I left that older gap alone.
- `postgres.virtual-key.adapter.ts` is not persistence - it is a test-only
  composition helper (`createVirtualKeyServiceForTest`), used solely by
  `testing.ts`, wiring already-existing repositories together. It takes a raw
  `PrismaClient` param, which violates "only repositories/prisma/** may name
  PrismaClient". Recommend moving its body into `testing.ts` directly (or
  `__tests__/support/`) and deleting the file - not a repository conversion.
- `postgres.gateway-transaction.adapter.ts` (`PrismaGatewayTransactionAdapter
  implements GatewayTransaction`) also names `PrismaClient` directly, same
  invariant violation. `GatewayTransaction` itself lives in the shared
  `app/gateway.members.ts` so only the concrete implementation moves. Needs
  `repositories/prisma/prisma.gateway-transaction.repository.ts` + a trivial
  memory twin (no real transactionality needed for the memory tier).
- `postgres.gateway-budget-resolution.adapter.ts` and `prisma.gateway.adapter.ts`
  are composition/wiring factories over already-existing repositories and
  services (not direct DB access themselves) - judged **not** Batch A
  persistence; they read as services/composition roots for the module's own
  internal wiring.
- `postgres.gateway-config-assembly.adapter.ts` is mostly pure computation
  (credential shaping, tier fallthrough) plus one call into the
  already-existing `PrismaGatewayScopeResolutionRepository`. Judged a
  **service**, not a repository - recommend `services/gateway-config-assembly.service.ts`,
  injecting the scope-resolution repository/service instead of taking a raw
  `PrismaClient` (same invariant violation as above).
- `clickhouse.gateway-open-admissions.adapter.ts` wraps the ALREADY-EXISTING
  `repositories/clickhouse/clickhouse.gateway-open-admissions.repository.ts`
  (single ClickHouse instance) with a multi-instance fan-out. The fan-out class
  itself is the one still missing a home in `repositories/`.

## 12. Unfinished work

1. Convert the four port abstract classes to `interface` (repoint every
   `extends` to `implements`): `gateway-internal-store.repository.ts` (already
   moved, still `abstract class`), `ports/gateway-open-admissions.port.ts`,
   `ports/gateway-spend-events.port.ts`, `ports/gateway-virtual-key.port.ts`.
   Do this before attempting any `gateway-repositories.registry.ts`.
2. `postgres.gateway-spend-scope.adapter.ts` -> new interface
   `GatewaySpendScopeRepository`, Prisma impl in `repositories/prisma/`, memory
   twin (no caching needed in memory), registry entry.
3. `clickhouse.gateway-open-admissions.adapter.ts` (the fan-out class) -> move
   into `repositories/clickhouse/`, memory twin, registry entry; relocate
   `ports/gateway-open-admissions.port.ts` first (item 1).
4. `adapters/gateway-spend-producer.adapter.ts` imports
   `../ports/gateway-spend-events.port.ts` - update once that port moves
   (item 1); the file itself stays Batch B (goes with the eventing channel).
5. `postgres.gateway-transaction.adapter.ts`, `postgres.virtual-key.adapter.ts`,
   `postgres.gateway-budget-resolution.adapter.ts`, `prisma.gateway.adapter.ts`,
   `postgres.gateway-config-assembly.adapter.ts` - reclassify per Risks above
   (transaction repo, deleted+inlined test helper, and two services) rather
   than converting as repositories.
6. Once `packages/runtime-composition` is fixed by its own session, re-run
   `typecheck:one modules/gateway/server`.
7. Build `gateway-repositories.registry.ts` for real, once item 1 is done -
   this run's attempt and its exact failure are recorded above so it is not
   repeated blind.

## 13. Completion status

Partial: 5 dead adapter files removed and one full persistence conversion
(GatewayInternalStore: interface + Prisma repo + memory twin, all renamed via
tslsp, all diagnostics clean) landed and independently committable. File count
24/31 remains (target 0 at end of Batch B). The registry/`defineRepositories`
wiring is blocked on a real design finding (abstract-class ports vs. the
interface convention `prismaRepositories()` needs) recorded above rather than
guessed at. `test:unit` is green; `typecheck:one` is blocked by an unrelated,
pre-existing error in another session's uncommitted work.
