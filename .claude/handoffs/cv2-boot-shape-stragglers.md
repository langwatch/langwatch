# Handoff: cv2-boot-shape-stragglers

Status: blocked
Manifest: .claude/manifests/cv2-boot-shape-stragglers.md
Updated: 2026-09-11 13:45

## 1. Identity

cv2-boot-shape-stragglers, first attempt, fresh lane (no prior handoff existed).

## 2. Objective

Move the last eight `.withInfrastructure(` callers onto the settled boot shape
(`createApp` + `withModules`/`withProvided`/members pool).

## 3. Owned paths

The eight files named in the manifest (7 installation tests + `apps/worker/src/app/worker-agent.composition.ts`).

## 4. Shared paths - do not edit

`packages/runtime-composition/src/**`, `apps/api/src/app/api-production.composition.ts`,
`apps/worker/src/app/worker-production.composition.ts`.

## 5. Work completed

`apps/worker/src/app/worker-agent.composition.ts` converted and verified as far
as possible without touching shared files:

- `AgentApp.reads = reads("redis")` (a canonical `ProcessMembers` name), so the
  fixture data fits the new seam cleanly. Replaced `.withInfrastructure(options.infrastructure)`
  with `members: membersFrom(options.infrastructure)` on `createApp(...)`.
- Dropped the `AgentInfrastructure` import from `@langwatch/agent-server` (no
  longer exported there) and declared it locally as `Readonly<{ redis:
  RedisConnection }>` - the same shape the existing caller
  (`worker-agent-apps.composition.ts`, unowned, unchanged) already passes.
- Fixed a real bug this exposed: `createApp({ role: "api", config: {} })` never
  threaded `options.config` (an `AgentAppConfig`) into the module config slice,
  so `withModules([withMemoryRepositories(agentServer)])` fails
  `ModuleConfigGuard` at compile time (agent declares a config schema keyed
  `"agent"`). Now passes `config: { agent: options.config }`.
- `tslsp-cli diagnostics` is clean on the file itself, on its caller
  (`worker-agent-apps.composition.ts`), and on its existing test
  (`worker-agent.composition.unit.test.ts`).

**The other 7 files were NOT touched.** See section 11 - this is the blocker.

## 6. Files changed

- `apps/worker/src/app/worker-agent.composition.ts` - modified (see above).

## 7. Checks completed

- `tslsp-cli diagnostics --file apps/worker/src/app/worker-agent.composition.ts` -> no diagnostics
- `tslsp-cli diagnostics --file apps/worker/src/app/worker-agent-apps.composition.ts` -> no diagnostics
- `tslsp-cli diagnostics --file apps/worker/src/app/__tests__/worker-agent.composition.unit.test.ts` -> no diagnostics
- `grep -rln '\.withInfrastructure(' modules enterprise apps` -> exactly the 7 untouched test files, nothing else
- `rtk pnpm typecheck:one apps/worker` -> FAILS, but in `packages/runtime-composition/src/feature-installer.ts`
  (shared, pre-existing, see section 11) before it ever reaches my file
- `VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/worker test:unit src/app/__tests__/worker-agent.composition.unit.test.ts`
  -> fails at import time, in `modules/presence/server/src/repositories/presence-repositories.registry.ts`
  (unowned, unrelated - see section 11), before any test body runs

## 8. Current failure

None inside my owned files. Two pre-existing, out-of-scope failures gate full
verification (both detailed in section 11).

## 9. Exact next action

Do not resume this lane's approach on the 7 test files as-is - it will not
converge without the design decision in section 11. Once the coordinator
decides how each module's custom "Infrastructure" collaborators should be
supplied under the new seam (see options below), a follow-up lane can convert
the 7 tests file-by-file, each paired with the matching change to that
module's `*.app.ts`. Meanwhile, re-run
`VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/worker test:unit src/app/__tests__/worker-agent.composition.unit.test.ts`
once `modules/presence/server/src/repositories/presence-repositories.registry.ts`
is fixed, to get the last runtime proof for `worker-agent.composition.ts`.

## 10. Shared-file requests

`packages/runtime-composition/src/feature-installer.ts`
  line 383-389, the `FeatureShape` interface has a duplicated generic parameter:
  ```
  interface FeatureShape<
    Config,
    Dependencies extends TokenMap,
    TransportDependencies extends TokenMap,
    Name extends string = string,
    Name
  > {
  ```
  Delete the stray second `Name` on line 388. This alone produces `TS2300`
  (duplicate identifier) plus six more `TS2344`/`TS2322`/`TS2304` errors
  downstream in the same file (`ServerFeatureBuilder`, `RepositoryDefinedFeatureBuilder`
  and others reference `Name` with no `extends string` bound) - after removing
  the duplicate, re-typecheck the file; the others may cascade-fix or may need
  `Name extends string` added to `ServerFeatureBuilder`'s own type parameter
  list (around line 408) and the other builder classes using `Name` the same
  way. This blocks `pnpm typecheck:one` for every application that imports
  `@langwatch/runtime-composition` (at least `apps/worker`, almost certainly
  `apps/api` too), independent of this task.

## 11. Risks

**Architecture decision - the manifest's premise does not hold for 6 of the 7
test files.** `createApp`'s `members` pool is a CLOSED set of 14 canonical
names (`packages/infrastructure/src/members.ts` - `ProcessMembers`: prisma,
clickhouse, redis, eventing, objectStorage, mail, clock, encryption, secrets,
cache, rateLimiter, idempotency, logger, telemetry). A module states which of
these 14 it reads with `static readonly reads = reads(...)` on its App; that
is the ENTIRE seam a process has for handing a module anything beyond a peer
Api token or a config slice. The old `.withInfrastructure(wholeObject)` was a
generic escape hatch that let a module receive ANY bespoke collaborator
bundle; it has been deleted with no replacement for non-canonical members.

I confirmed, for each of the 6 (workflow, stored-object, dashboard,
evaluation, ops, entitlement - not presence, see below), that its App:
- declares `static readonly dependencies` (peer tokens) but no `static
  readonly reads` at all today, and
- its own `*Infrastructure` type (`WorkflowInfrastructure`,
  `DashboardInfrastructure`, `StoredObjectInfrastructure`,
  `EntitlementInfrastructure`, `OpsAppInfrastructure`) is a bag of module-private
  collaborators (e.g. workflow's `studioDsl`, `agentMappings`, `workflowRows`,
  `permissions`, `lineage`, `publications`, `nlpLambdaFleet`, ~20 more) - none
  of which are among the 14 canonical members.

Getting these tests to pass therefore requires deciding, per field, one of:
(a) it maps to a canonical member and the App gets `reads(...)` added,
(b) it is really a peer Api and should move to `dependencies`/`withProvided`,
(c) it is derived inside the App itself from members+config+dependencies it
    already has, or
(d) the member vocabulary needs a 15th name added (a bigger call, touching the
    shared `packages/infrastructure/src/members.ts`).
This is 6 separate module-level design calls, each touching a `*.app.ts` file
outside my owned paths, which is exactly LANE.md section 8 / the manifest's
stop condition 3. I did not guess at any of them.

Four of the six already have a half-migrated `*.members.ts` file sitting next
to the unconverted `*.app.ts` (stored-object, dashboard, evaluation,
entitlement) - strong evidence another concurrent, uncommitted lane is mid-way
through exactly this conversion. Worth checking with the coordinator before
opening a new lane, to avoid duplicating or colliding with that work.

**`presence` is a separate, narrower bug, not this same architecture gap.**
`modules/presence/server/src/repositories/presence-repositories.registry.ts`
calls `defineRepositories({ redis: RedisPresenceRepositories, memory:
MemoryPresenceRepositories })`, but those two are plain classes, not the
`{requires, create, repositories}` provider-object shape `defineRepositories`
expects - it throws `TypeError: Cannot read properties of undefined (reading
'requires')` at import time, before any test body runs. This is unowned by me
and unrelated to `.withInfrastructure`; it also blocks `PresenceInfrastructure`
custom-collaborator question above once that part is fixed.

I verified the manifest's own second exemplar,
`modules/secret/server/src/app/__tests__/secret-installation.unit.test.ts`
("already converted"), currently FAILS on the tree for a related reason: it
supplies no `members` source at all, yet `SecretApp.reads = reads("encryption")`,
so every test in it throws `MissingMemberError`. This is presumably
concurrent, uncommitted work in flight rather than a stable reference; treat it
with caution as a "done" exemplar until it is green again.

## 12. Unfinished work

1. Coordinator decision on the six modules' custom collaborators (section 11) -
   architecture call, not mechanical.
2. Once decided, convert each of the 6 `*-installation.unit.test.ts` files
   together with its `*.app.ts` (each is its own small lane - do not bundle).
3. `presence-installation.unit.test.ts` additionally needs
   `presence-repositories.registry.ts` fixed first (separate, narrower, likely
   mechanical: give `RedisPresenceRepositories`/`MemoryPresenceRepositories`
   the registry provider shape).
4. Shared `packages/runtime-composition/src/feature-installer.ts` duplicate
   `Name` generic (section 10) - blocks `typecheck:one` for `apps/worker`
   (and likely `apps/api`) regardless of this task; worth fixing on its own,
   fast, since it looks like a one-line accidental duplication.

## 13. Completion status

1 of 8 files done and internally consistent (`worker-agent.composition.ts`,
tslsp-clean on itself, its caller and its test); the runtime test run is
blocked by an unrelated, unowned bug in `presence`. The remaining 7 files are
blocked on an architecture decision the manifest did not anticipate: the new
`members` pool has no seam for the bespoke, module-private collaborators these
modules' `.withInfrastructure()` used to carry. Nothing false was landed - no
test file was left in a partially-converted, still-failing state.
