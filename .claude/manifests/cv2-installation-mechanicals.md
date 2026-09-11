# Manifest: cv2-installation-mechanicals

Objective: The six module installation tests that fail for reasons unrelated to the missing `withModule` seam pass again, each for the reason its own module needs.
Owner: cv2-installation-mechanicals
Model: sonnet   <six independent, diagnosed, small-radius fixes with an exemplar for each; no design call among them>
Budget: 110 tool calls or 75 minutes, whichever comes first
Handoff: .claude/handoffs/cv2-installation-mechanicals.md

## Context

21 module installation tests exist. **16 fail.** Ten of those sixteen are blocked
on `withModule`, which does not exist yet and is another lane's work
(`.claude/manifests/cv2-with-module-seam.md`). **These six are not blocked on
anything.** Each was measured on 2026-09-11 at `6436e4668c` and its first error
is quoted below. Do not re-triage them from scratch; confirm and fix.

Modules that are NOT yours, in any file: dashboard, entitlement, evaluation, ops,
stored-object, workflow, feature-flag, monitor, data-retention, user. If a fix of
yours seems to require one of them, that is a stop condition.

## The six, with the measured failure

| Module | First error | Shape of the fix |
| --- | --- | --- |
| `secret` | `MissingMemberError: Module "secret" reads the "encryption" member, which this process cannot supply.` | the test supplies no member source; give `createApp` a `members:` built with `membersFrom({ encryption: <fake> })` |
| `share` | `MissingMemberError: ... reads the "redis" member ...` | same, `redis` |
| `suite` | `MissingMemberError: ... reads the "clickhouse" member ...` | same, `clickhouse` |
| `metric` | `Error: Module "metric" declares no repositories, so it has no memory tier to install.` | the test calls `withMemoryRepositories(metricServer)` on a module that declares none; install it plainly |
| `topic` | `ReferenceError: role is not defined` | `function process(schedule = ...)` at `topic-installation.unit.test.ts:9` references `role`, which is not a parameter, while `schedule` is unused; callers pass a role in one place and a schedule in another. A conversion was left half-done - restore a signature that serves both call sites |
| `presence` | `TypeError: Cannot read properties of undefined (reading 'requires')` | `presence-repositories.registry.ts` hands `defineRepositories` two plain classes; it expects the `{requires, create, repositories}` provider shape. Give each backend that shape |

`secret`, `share` and `suite` are one pattern three times. Do that pattern once,
well, then repeat it.

## Owned paths

    modules/secret/server/src/app/__tests__/**
    modules/share/server/src/app/__tests__/**
    modules/suite/server/src/app/__tests__/**
    modules/metric/server/src/app/__tests__/**
    modules/topic/server/src/app/__tests__/**
    modules/presence/server/src/app/__tests__/**
    modules/presence/server/src/repositories/presence-repositories.registry.ts
    modules/presence/server/src/repositories/memory/memory.presence.repositories.ts
    modules/presence/server/src/repositories/redis/redis.presence.repositories.ts

A fixture file under one of those `__tests__/` directories is yours. Anything
outside them is not, including every `*.app.ts` and every `*.server.ts`.

## Shared paths - stop and request

    packages/runtime-composition/src/**        lane cv2-with-module-seam - LIVE, do not touch
    packages/infrastructure/src/members.ts     coordinator
    modules/*/server/src/app/*.app.ts          not yours
    modules/*/server/src/*.server.ts           not yours
    packages/architecture-lint/src/*-baseline.json   coordinator

`packages/runtime-composition` is being edited by another lane right now. Read it
freely, edit nothing in it, and if your fix appears to need a change there, stop
and record it - do not wait and do not work around it.

## Read-only reference paths

    modules/notification/server/src/app/__tests__/notification-installation.unit.test.ts
        a passing test, simplest possible shape
    modules/role/server/src/app/__tests__/role-installation.unit.test.ts
        a passing test with peers supplied via withProvided
    modules/annotation/server/src/app/__tests__/annotation-installation.unit.test.ts
        a passing test, the fullest of the five that pass
    packages/runtime-composition/src/module-members.ts:50-66
        `membersFrom` - the member source a test hands to `createApp`, and the refusal it documents
    packages/infrastructure/src/members.ts:119-135
        `ProcessMembers` - the 14 canonical names and their interfaces, so a fake satisfies the right one
    packages/runtime-composition/src/feature-installer.ts
        `defineRepositories` and the provider shape presence must satisfy

`data-privacy` and `dataset` also pass; read them if the three above are not
enough.

## Target shape

For the three `MissingMemberError` tests, the end shape is the existing
`process()` helper with a member source added:

    createApp({
      role,
      config: {},
      members: membersFrom({ encryption: <a fake satisfying Encryption> }),
    })

The fake is the narrowest thing that satisfies the interface in
`packages/infrastructure/src/members.ts` and makes the test's assertions true. A
frozen clock, an in-memory map, a deterministic id - not a mock framework, and
not a real client. If a fake grows past a handful of lines, put it in that
module's existing `*.fixture.ts` beside the test.

For `topic`, both call sites must work: `process("api")` / `process("worker")`
and `process(UnscheduledTopicClustering.create(topicTestWake(WAKE)))`. Named
parameters are the house style for more than one argument.

## Invariants

- Every assertion that exists today still exists and still asserts the same
  thing. You are fixing the wiring these tests boot with, not their expectations.
- Do not delete, skip, `it.todo` or `.only` any test. Do not weaken an assertion
  to reach green. A test you cannot make pass stays failing and goes in the handoff.
- No test reaches a real Postgres, ClickHouse or Redis. These are unit tests and
  they stay unit tests - no container, no `.integration.test.ts` rename.
- No new dependency.
- No production source file changes except the three `presence` repository files
  named in Owned paths.
- Do not add a backwards-compatibility re-export or alias. A previous lane added
  four and reported them as "no wire difference"; they were reverted.

## Checks

Per module, as you finish it:

    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/secret-server test:unit src/app/__tests__/secret-installation.unit.test.ts
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/share-server test:unit src/app/__tests__/share-installation.unit.test.ts
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/suite-server test:unit src/app/__tests__/suite-installation.unit.test.ts
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/metric-server test:unit src/app/__tests__/metric-installation.unit.test.ts
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/topic-server test:unit src/app/__tests__/topic-installation.unit.test.ts
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/presence-server test:unit src/app/__tests__/presence-installation.unit.test.ts

Then once each, at the end, only for the modules you changed:

    rtk pnpm typecheck:one modules/<module>/server

`presence` additionally runs its full package suite once, because you changed
three of its source files:

    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/presence-server test:unit

Never a whole-tree check. Never `pnpm typecheck`. Never `CI=1`.

## Stop conditions

- a fix needs a file outside Owned paths, including any `*.app.ts`
- a fix needs `packages/runtime-composition` to change
- a test's assertion looks wrong rather than its wiring - record it, do not rewrite it
- `presence`'s registry turns out to need a repository-tier design call rather than the provider shape
- the budget is reached

## Completion criteria

- all six named tests pass, run one at a time by the commands above, with every
  original assertion intact
- `presence`'s full package unit suite passes
- `rtk pnpm typecheck:one modules/<module>/server` clean for each module touched
- no test deleted, skipped or weakened; no `.only` left behind
- no file outside Owned paths modified - the handoff lists every file changed
- the handoff records, per module, the one-line reason it was failing and what fixed it
