# Handoff: cv2-installation-mechanicals

Status: partial
Manifest: .claude/manifests/cv2-installation-mechanicals.md
Model: claude-sonnet-5 / effort 40 (read — stated directly in this run's system prompt)
Updated: 2026-09-11 14:55

## 1. Identity

Single lane, first and only attempt on this manifest. No prior handoff existed.

## 2. Objective

Make six diagnosed-but-unrelated module installation test failures pass again
(secret, share, suite, metric, topic, presence), each fixed for its own
measured reason, without touching `withModule`/`packages/runtime-composition`.

## 3. Owned paths

    modules/secret/server/src/app/__tests__/**
    modules/share/server/src/app/__tests__/**
    modules/suite/server/src/app/__tests__/**
    modules/metric/server/src/app/__tests__/**
    modules/topic/server/src/app/__tests__/**
    modules/presence/server/src/app/__tests__/**
    modules/presence/server/src/repositories/presence-repositories.registry.ts
    modules/presence/server/src/repositories/memory/memory.presence.repositories.ts
    modules/presence/server/src/repositories/redis/redis.presence.repositories.ts

## 4. Shared paths - do not edit

    packages/runtime-composition/src/**   (cv2-with-module-seam, LIVE)
    packages/infrastructure/src/members.ts
    modules/*/server/src/app/*.app.ts
    modules/*/server/src/*.server.ts
    packages/architecture-lint/src/*-baseline.json

Not touched.

## 5. Work completed

- `secret`: fixed. `createApp` now gets `members: membersFrom({ encryption: new ReversibleTestSecretEncryption() })`. All 4 tests pass.
- `share`: fixed. Added `createShareTestRedis()` to `share.fixture.ts` (a redis connection cast, never called by these assertions — the not-found and empty-list paths never reach the cache). `createApp` gets `members: membersFrom({ redis: createShareTestRedis() })`. Both tests pass.
- `suite`: fixed. Added `createSuiteTestClickHouse()` to `suite.fixture.ts` (same pattern — the create/list assertions never touch the ClickHouse-backed run repository). `createApp` gets `members: membersFrom({ clickhouse: createSuiteTestClickHouse() })`. All 3 tests pass.
- `metric`: fixed. `metricServer` declares no `.withRepositories(...)`, so it has no memory tier — `withMemoryRepositories(metricServer)` always throws by design. Installed it plainly: `.withModules([metricServer])`. Test passes.
- `topic`: partially fixed, one sub-test still fails, root cause outside owned paths (see section 11/12).
- `presence`: partially fixed, one genuine bug fixed, two blockers remain outside owned paths (see section 11/12).

All fixes preserve every original assertion; nothing skipped, `.only`'d, or weakened.

## 6. Files changed

- `modules/secret/server/src/app/__tests__/secret-installation.unit.test.ts` (modified)
- `modules/share/server/src/app/__tests__/share-installation.unit.test.ts` (modified)
- `modules/share/server/src/app/__tests__/share.fixture.ts` (modified — added `createShareTestRedis`)
- `modules/suite/server/src/app/__tests__/suite-installation.unit.test.ts` (modified)
- `modules/suite/server/src/app/__tests__/suite.fixture.ts` (modified — added `createSuiteTestClickHouse`)
- `modules/metric/server/src/app/__tests__/metric-installation.unit.test.ts` (modified)
- `modules/topic/server/src/app/__tests__/topic-installation.unit.test.ts` (modified — fixed the `ReferenceError: role is not defined`)
- `modules/presence/server/src/repositories/presence-repositories.registry.ts` (modified — registry key `redis:` renamed to `live:`; the class-level `{requires, create}` provider shape on both `MemoryPresenceRepositories` and `RedisPresenceRepositories` was already correct)

## 7. Checks completed

    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/secret-server test:unit src/app/__tests__/secret-installation.unit.test.ts -> 4 passed
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/share-server test:unit src/app/__tests__/share-installation.unit.test.ts -> 2 passed
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/suite-server test:unit src/app/__tests__/suite-installation.unit.test.ts -> 3 passed
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/metric-server test:unit src/app/__tests__/metric-installation.unit.test.ts -> 1 passed
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/topic-server test:unit src/app/__tests__/topic-installation.unit.test.ts -> 2 passed, 1 failed
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/presence-server test:unit src/app/__tests__/presence-installation.unit.test.ts -> 0 passed, 2 failed (module now loads; both fail on `.withInfrastructure is not a function`)
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/presence-server test:unit -> 42 passed, 20 failed — all 20 failures are pre-existing and outside owned paths (see Risks)
    rtk pnpm typecheck:one modules/{secret,share,suite,metric,topic,presence}/server -> all fail, but every reported error is in a file I did not touch and is unrelated to this task's changes (see Risks)

## 8. Current failure

- `topic`: `TypeError: Cannot read properties of undefined (reading 'findNextWakeAt')` at `topic.service.ts:43`, in the "reports it as the next run" sub-test.
- `presence`: `TypeError: createApp(...).withInfrastructure is not a function`, both installation sub-tests.

## 9. Exact next action

Nothing left in owned paths for this manifest. The coordinator should either
(a) accept `secret`/`share`/`suite`/`metric` as done and open follow-up work
for `topic`/`presence` once `cv2-with-module-seam` lands `withModule`, or
(b) route the two remaining items to that lane directly, since both dead-end
in the exact seam it is building.

## 10. Shared-file requests

None. (The two blockers below are not requests to change owned paths — they
are places outside owned paths that need the with-module seam, recorded for
whoever picks this up next.)

## 11. Risks

- **topic (blocked on with-module seam):** `TopicApp` (`modules/topic/server/src/app/topic.app.ts`) declares no `static readonly reads`, and `schedule`/`now` are not canonical `ProcessMembers` names, so they cannot be added to `reads(...)` even if that file were mine. The only place `TopicInfrastructure.schedule` can be wired is a per-module infrastructure builder — exactly what `worker-tenancy.composition.ts` already assumes exists (`.withModule(organizationServer, { infrastructure: {...} })`) but which `packages/runtime-composition/src/application.ts` does not implement yet (only bulk `withModules` exists, no per-module `withModule`/`withInfrastructure`). I traced this through `application.ts` (`requiredMembers = declaredReads(app)`, `membersFor` only copies declared names) and confirmed empirically: the test throws exactly where a real, working `schedule` would be needed. I fixed the actual diagnosed bug (the `ReferenceError`) and left the wiring gap for the seam lane.
- **presence (blocked on with-module seam):** After my registry fix, the module now loads, but `presence-installation.unit.test.ts` calls `createApp(...).withInfrastructure({...})`, a method that does not exist anywhere in `packages/runtime-composition` (grepped the whole package — zero definitions). This is the same missing seam as topic's, one layer further along (the test file already assumes the seam shipped). Not fixable from owned paths.
- **presence full package suite (42 passed, 20 failed):** all 20 failures are in files outside owned paths and are unrelated to the registry key I fixed:
  - `src/repositories/memory/__tests__/memory.presence.repository.unit.test.ts` (3 failures): calls `instantiateRepositories(presenceRepositories, { backend: "memory", members: {} })` — the field is `tier`, not `backend`, so `selection.tier` is `undefined` regardless of my registry fix. Confirmed this fails identically whether the registry key is `redis` or `live`, since the lookup is `registry.definitions[undefined]` either way.
  - `src/services/__tests__/broadcast-tenant-rate-limiter.service.unit.test.ts` (multiple failures): `ReferenceError: BroadcastAdapter is not defined` — a bug local to that test file (destructures `{ BroadcastAdapter: RedisBroadcastRepository }` then references the un-destructured name `BroadcastAdapter`), unrelated to repositories.
  - Neither file is in my owned paths.
- **typecheck:one fails for every module I touched**, but every single reported error is in a file I never edited (`modules/secret/server/src/secret.server.ts`, `modules/secret/server/src/transport/secret.rest.ts`, `modules/authz/server/src/eventing/authz-grant.store.ts`, three `*.rest.ts` files under `modules/suite/server/src/transport/`, `packages/test-harness/src/test-logger.ts`, several files under `modules/topic/server/src/`). These are all `TS2883`/`TS1484`/`TS2430`/`TS2307` errors in the shared `typecheck:declarations` pass, unrelated to member-source or repository-registry wiring, and pre-date this lane (matches the very large unrelated diff already in `git status` at session start). I did not attempt to fix any of them — they are outside owned paths.

## 12. Unfinished work

1. `topic`: once `withModule`/per-module infrastructure exists, wire `TopicInfrastructure.schedule`/`now` into the test's `process()` so the "reports it as the next run" sub-test can actually receive the injected schedule reader. Requires touching `topic.app.ts` and/or `topic.server.ts` (not owned by this manifest) as well as the test.
2. `presence`: once `createApp(...).withInfrastructure(...)` (or whatever the seam lane ships) exists in `packages/runtime-composition`, the two `presence-installation.unit.test.ts` sub-tests should be re-run; no test-file change should be needed beyond that, since the test already calls the intended API shape.
3. (Not part of this manifest, flagged only) `memory.presence.repository.unit.test.ts` and `broadcast-tenant-rate-limiter.service.unit.test.ts` have pre-existing, unrelated bugs — worth a separate small manifest.

## 13. Completion status

4 of 6 named tests (secret, share, suite, metric) are fully green with every
original assertion intact and no owned-path issues. The other 2 (topic,
presence) each got the one fix that was legitimately mine (a real
`ReferenceError` in topic's test helper; a wrong tier key in presence's
registry) but both dead-end in the same missing `withModule`/per-module
infrastructure seam that `cv2-with-module-seam` is building live — confirmed
by tracing the actual runtime-composition source, not assumed. What landed is
independently committable as-is.
