# Manifest: cv2-rest-credential-object

Objective: Let the REST runtime resolve a credential OBJECT for a route, so a
family that asks a question about its own credential can declare it rather than
having the process bind it with `bindRestMiddleware` - which is what lets
`apps/api/src/features/<m>/<m>-rest.mount.ts` finally be deleted.
Owner: unassigned
Model: opus   - it changes what a route declaration means and what the audit
trail records. Both are contracts.
Budget: 100 tool calls
Handoff: .claude/handoffs/cv2-rest-credential-object.md
Depends on: cv2-application-member-record

## The problem

`composition-v2.md` finding 4: the REST runtime cannot resolve a credential
object for a route. `apiKeyRestCredential` asks whether the KEY may act
organization-wide, not only its holder, and that fact is still bound by the
process with `bindRestMiddleware`. Until this lands, no family that asks a
question about its own credential can delete its mount file.

This is step 4 of the plan. It is also what drains `families_unbound`, which is
the count of `*/transport/*.rest.ts` files still calling `withMiddleware(` - 47
of 80 families at a08cbd27b8. That number falls as a **by-product** of this task
landing and the families then converting; it is not its own task and not a target
to chase directly.

## Owned paths

```
packages/api/src/**                   the REST runtime and the route declaration
packages/api/tests/**
packages/runtime-composition/src/**   only where the declaration is resolved
```

**One** proving family, named in the handoff before you change it. `api-key` is
the obvious candidate - it is the one with a bound credential already. The other
46 convert later, in T5, per module.

## Shared paths - stop and request

```
apps/api/src/app-rest/api-rest.doors.ts            coordinator
apps/api/src/app/api-production.composition.ts     coordinator
packages/handled-error/src/presentation.ts         coordinator
packages/architecture-lint/src/*-baseline.json     coordinator
```

## Read-only reference paths

```
dev/docs/plans/composition-v2.md     step 4, and findings 3, 4 and 5
dev/docs/adr/144-*.md                the declaration's contract
modules/api-key/server/src/**        apiKeyRestCredential, the credential in question
modules/annotation/server/src/transport/**   a declaration with no credential question
modules/agent/server/src/transport/agent-connect.rest.ts
                                     bound facts and public access, per the lane brief
apps/api/src/features/api-key/**     the mount file this task is meant to make deletable
```

## Target shape

A route declares the credential object it needs; the runtime resolves it. The
process stops binding that fact with `bindRestMiddleware`.

Three findings the plan records that bear directly on this and must be **stated,
not discovered**:

- **Finding 5, and it is a behaviour change.** An audit action must be dotted
  lower kebab - `assertAuditAction` refuses `management.apiKey.read`, so moving a
  mount-side action onto a route renames what the trail records
  (`management.api-key.read`, `management.api-key.update`). And the runtime
  writes an audit row for a **refusal**, carrying the handled code, where the
  mount-side middleware wrote one only after a 2xx. That is a widening of the
  audit trail. Declare it in the handoff under wire differences; do not let it
  arrive as a surprise in production.
- **Finding 3.** The tRPC half has no `withAudit`. Before asking for that
  primitive, check whether the curated row is simply a duplicate of the automatic
  mutation row - in api-key's case it was, and the fix was a redaction rule, not
  a new declaration.
- **Finding 4** is this task. Read it before starting.

## Invariants

- **The wire does not move.** Route paths, inputs, outputs, statuses and
  permissions stay as they are on `origin/main`. Find the current shape with
  `git grep -n "<name>" origin/main -- <path>`. A status collapsed to 200, or a
  permission that stopped being checked, is a regression - stop and report it.
- The audit widening above is the one declared, deliberate difference. Any other
  is a defect.
- An audit action is dotted lower kebab. Assert on the action string in a test.
- A new error code needs its `packages/handled-error/src/presentation.ts` entry
  in the same change, and that file is shared - hand the coordinator the lines.
- Assert on error `code`, never on message prose.
- No `as unknown as`, no non-null `!`, no `ctx: unknown`.
- British English, no em dashes - write " - " instead.

## Checks

```
VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/api test:unit
VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/api-key-server test:unit
rtk pnpm typecheck:one packages/api          (once, at the end)
```

Plus a transport test that mounts the real router on a real
`createApiRestRuntime` - exemplar
`modules/suite/server/src/transport/__tests__/test-suites.rest.integration.test.ts`,
beside `apps/api/src/app-rest/__tests__/api-rest.host.integration.test.ts` for the host.
A package suite does not prove a route still answers on the same path to the same
caller; only the mount test does.

## Stop conditions

- a shared path is needed;
- the wire would have to move for the declaration to work;
- the audit widening turns out to be larger than finding 5 describes;
- the budget is reached.

## Completion criteria

- A route can declare a credential object and the runtime resolves it.
- The proving family no longer needs `bindRestMiddleware` for that fact, and its
  mount file is deletable - say so, and whether you deleted it.
- The mount integration test passes and the served routes match `origin/main`.
- The audit widening is stated in the handoff with the exact old and new action
  strings.
- `typecheck:one packages/api` is clean.
- The handoff names how many of the 47 `withMiddleware(` families this unblocks,
  and any it does not.
