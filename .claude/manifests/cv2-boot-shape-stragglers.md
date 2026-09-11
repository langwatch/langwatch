# Manifest: cv2-boot-shape-stragglers

Objective: Move the last eight callers of `.withInfrastructure(` onto the settled
boot shape. The method no longer exists on `createApp`, so all eight are broken
today - seven installation tests fail, and one is a real worker composition root.
Owner: unassigned
Model: sonnet   - mechanical, with fourteen converted exemplars in the tree. No
design decisions.
Budget: 70 tool calls
Handoff: .claude/handoffs/cv2-boot-shape-stragglers.md

## The problem, measured at 73d4fdb67d

`createApp()` offers `withModules`, `withTransports`, `withProvided` and
`withService`. `withInfrastructure` is gone. These eight still call it:

```
modules/workflow/server/src/app/__tests__/workflow-installation.unit.test.ts
modules/stored-object/server/src/app/__tests__/stored-object-installation.unit.test.ts
modules/dashboard/server/src/app/__tests__/dashboard-installation.unit.test.ts
modules/presence/server/src/app/__tests__/presence-installation.unit.test.ts
modules/evaluation/server/src/app/__tests__/evaluation-installation.unit.test.ts
modules/ops/server/src/app/__tests__/ops-installation.unit.test.ts
modules/entitlement/server/src/app/__tests__/entitlement-installation.unit.test.ts
apps/worker/src/app/worker-agent.composition.ts
```

The first seven are tests that fail with
`TypeError: createApp(...).withInfrastructure is not a function`. **The eighth is
a composition root**, which means the worker's agent composition does not boot.
Treat that one as the important one; the tests are the easy half.

Fourteen installation tests are already converted. This is the tail of that pass.

## Owned paths

```
modules/workflow/server/src/app/__tests__/workflow-installation.unit.test.ts
modules/stored-object/server/src/app/__tests__/stored-object-installation.unit.test.ts
modules/dashboard/server/src/app/__tests__/dashboard-installation.unit.test.ts
modules/presence/server/src/app/__tests__/presence-installation.unit.test.ts
modules/evaluation/server/src/app/__tests__/evaluation-installation.unit.test.ts
modules/ops/server/src/app/__tests__/ops-installation.unit.test.ts
modules/entitlement/server/src/app/__tests__/entitlement-installation.unit.test.ts
apps/worker/src/app/worker-agent.composition.ts
```

Exactly these eight files. If a fixture beside one of them must change for the
test to pass, that fixture joins the list - name it in the handoff.

**Do not touch `modules/gateway`.** Another lane is converting it right now.

## Shared paths - stop and request

```
packages/runtime-composition/src/**                coordinator - the seam itself
apps/api/src/app/api-production.composition.ts     coordinator
apps/worker/src/app/worker-production.composition.ts   coordinator
```

`worker-agent.composition.ts` is yours. The other worker compositions are not.

## Read-only reference paths

```
modules/annotation/server/src/app/__tests__/annotation-installation.unit.test.ts   THE EXEMPLAR
modules/secret/server/src/app/__tests__/secret-installation.unit.test.ts           a second one
modules/dataset/server/src/app/__tests__/dataset-installation.unit.test.ts         a third
packages/runtime-composition/src/application.ts    what createApp actually offers now
packages/infrastructure/src/**                     the member record
```

Read the annotation exemplar first and copy its shape. Fourteen tests already
made this move; you are matching them, not inventing anything.

## Target shape

Whatever the fourteen converted tests do. In outline: a process supplies members
by name through the member record rather than handing in an `Infrastructure`
object, and a module declares what it reads.

`git log --oneline -20 -- modules/annotation/server/src/app/__tests__/` will show
the commit that converted them, and its diff is the recipe.

## Invariants

- **Behaviour does not change.** A test that asserted something before asserts
  the same thing after. If a converted test would assert less, say so rather than
  quietly weakening it.
- `worker-agent.composition.ts` must actually compose. It is not a test; getting
  it wrong takes the worker down.
- No `as unknown as`, no non-null `!`, no `ctx: unknown`.
- `it("does x")` not `it("should do x")`.
- British English, no em dashes - write " - " instead.
- No git writes of any kind. The tree carries four other sessions' uncommitted
  work and the coordinator commits.

## Checks

Per module you touch, that module's own suite:

```
VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/<module>-server test:unit src/app
```

Then once, at the end:

```
rtk pnpm typecheck:one apps/worker
grep -rln '\.withInfrastructure(' --include='*.ts' modules enterprise apps packages | grep -v node_modules
```

That grep must come back empty. Nothing wider - no whole-tree typecheck or lint.

## Stop conditions

- a shared path is needed - in particular if `createApp` itself would have to
  change, which would mean the seam is wrong rather than these eight callers;
- a converted test cannot assert what it asserted before;
- the budget is reached.

## Completion criteria

- No file in the repository calls `.withInfrastructure(`.
- All seven installation tests pass.
- `apps/worker` typechecks and `worker-agent.composition.ts` composes.
- The handoff names, per file, what it now supplies and how.
