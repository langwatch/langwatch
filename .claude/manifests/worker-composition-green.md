# Manifest: worker-composition-green

Objective: The three failing `apps/worker` test files pass, so the uncommitted worker composition work in the tree can be committed and the tree can reach zero dirty.
Owner: worker-composition-green
Model: sonnet   <three concrete runtime failures with stack frames already located; tracing a broken export and a lost validation is ordinary debugging, not design>
Budget: 90 tool calls or 60 minutes, whichever comes first
Handoff: .claude/handoffs/worker-composition-green.md

## Context

The working tree holds **uncommitted** worker composition work: twelve modified
files plus two renames of `*.infrastructure.ts` to `*.members.ts` under
`src/platform/infrastructure/`. `rtk pnpm typecheck:one apps/worker` is clean
except two errors in `modules/data-retention` (another package, pre-existing,
**not yours**), but three test files fail at runtime.

This is the last thing standing between the tree and zero dirty, which a main
merge needs before it can start. Finish it; do not re-plan it.

Relevant recent change: `ApplicationBuilder.withModule(module, { members })`
landed at `ea8cd081b4` and the six worker roots passing the older
`infrastructure:` key were renamed to `members:` at `d5c2db2822`. If a failure
traces to that seam, read `packages/runtime-composition/src/application.ts` -
but you may not edit it.

## The three failures, measured at `d5c2db2822`

Reproduce all three with:

    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/worker test:unit \
      src/app/__tests__/worker-tenancy.composition.unit.test.ts \
      src/app/__tests__/worker-tenancy-ownership.composition.unit.test.ts \
      src/__tests__/worker.executable.unit.test.ts

1. **`worker-tenancy-ownership.composition.unit.test.ts` - `Error: Transform
   failed with 1 error`, 0 tests collected.** The file (or something it imports)
   does not parse. Run that one file alone first: the transform error names a
   line, and it is usually a half-finished edit. Start here, it is the cheapest.

2. **`worker-tenancy.composition.unit.test.ts` - `TypeError: Class extends value
   undefined is not a constructor or null`**, thrown at
   `src/app/worker-automation-graph.composition.ts:243:44`, reached from
   `src/app/worker-tenancy-infrastructure.composition.ts:21:1`. A class is
   extending something that is `undefined` at module-evaluation time - either an
   export that moved or no longer exists, or a circular import between those two
   composition files. Establish which before changing anything: a missing export
   and a cycle look identical at the throw site and have opposite fixes.

3. **`worker.executable.unit.test.ts` - "validates boot configuration before
   composing a Worker graph"** expected a throw including `Invalid worker
   configuration` and got `Cannot read properties of undefined`. The validation
   that used to run before composition now runs after it, or its input moved, so
   the graph is built first and dies on a missing field. The assertion is right;
   the order of operations is what regressed.

## Owned paths

    apps/worker/src/app/**
    apps/worker/src/__tests__/**
    apps/worker/src/platform/**

## Shared paths - stop and request

    apps/worker/src/app/worker-production.composition.ts       coordinator
    apps/worker/src/app/worker-tenancy*.composition.ts         coordinator
    packages/runtime-composition/**                            coordinator - just changed, read only
    modules/workflow/**                                        another lane - LIVE, do not read as reference
    modules/**                                                 not yours
    apps/api/**                                                coordinator

`worker-production.composition.ts` and `worker-tenancy*.composition.ts` are the
coordinator's. You will probably need a change in one of them for failure 2 -
write the exact lines into handoff section 10 and carry on with the other two.
Do not edit them.

## Read-only reference paths

    packages/runtime-composition/src/application.ts
        `withModule`, `withModules`, `withProvided`, and the members guard
    apps/worker/src/app/worker-ops-app.composition.ts
        a root already using `withModule(module, { members })` correctly
    apps/worker/src/platform/infrastructure/worker-database.members.ts
        the `*.members.ts` shape the two renames land on

## Invariants

- The three tests' assertions stay as they are. Failure 3 in particular: make the
  validation run before composition again, do not relax the expectation.
- Do not delete, skip, `it.todo` or `.only` any test.
- No new dependency. No re-export added for backwards compatibility.
- Do not rename or move a file. The two renames in the tree are already correct.
- A value-import from `apps/ui` or any browser-only package into worker code is
  refused by architecture-lint - do not reach for one to resolve failure 2.

## Checks

    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/worker test:unit src/app/__tests__/worker-tenancy-ownership.composition.unit.test.ts
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/worker test:unit src/app/__tests__/worker-tenancy.composition.unit.test.ts
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/worker test:unit src/__tests__/worker.executable.unit.test.ts

Then once, at the end:

    rtk pnpm typecheck:one apps/worker

Two `modules/data-retention` errors (`TenantClickHouseClientResolver` missing,
`toReversed`) are expected and are not yours. Any OTHER error is.

Never a whole-tree check, never `pnpm typecheck`, never `CI=1`.

## Stop conditions

- a fix needs `worker-production.composition.ts` or `worker-tenancy*.composition.ts`
- a fix needs `packages/runtime-composition` or any `modules/` file
- failure 2 turns out to be a genuine circular-import redesign rather than a moved
  export - record what the cycle is and stop
- the budget is reached

## Completion criteria

- all three named test files pass, run by the commands above
- `rtk pnpm typecheck:one apps/worker` reports only the two known
  `modules/data-retention` errors
- no test deleted, skipped or weakened; no `.only` left behind
- no file moved or renamed
- the handoff says, for each of the three, what the cause was and what fixed it -
  and for failure 2 specifically, whether it was a moved export or a cycle
