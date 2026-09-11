# Manifest: cv2-application-member-record

Objective: Connect `packages/runtime-composition/src/application.ts` to
`@langwatch/infrastructure`'s member record, so a process supplies members by
name and a module declares what it reads - and delete the `Tier` /
`persistenceFor(pool)` inference ADR-144 decision 2 refuses.
Owner: unassigned
Model: opus   - this is the architecture decision the whole drive is blocked on.
It changes the seam every module composes through, and getting it wrong is paid
for once per module afterwards.
Budget: 120 tool calls or 90 minutes
Handoff: .claude/handoffs/cv2-application-member-record.md

## Owned paths

```
packages/runtime-composition/src/application.ts
packages/runtime-composition/src/module-members.ts
packages/runtime-composition/src/__tests__/**
packages/runtime-composition/tests/**
```

Nothing else. In particular no module and no application composition root -
those convert afterwards, in T5, and a lane that starts repointing them here
turns the critical path into a 2,000-file diff.

## Shared paths - stop and request

```
apps/api/src/app/api-production.composition.ts     coordinator
apps/api/src/app-rest/api-rest.doors.ts            coordinator
apps/worker/src/app/worker-tenancy*.composition.ts coordinator
packages/architecture-lint/src/*-baseline.json     coordinator
modules/catalogue.json                             coordinator
```

## Read-only reference paths

```
dev/docs/plans/composition-v2.md          THE PLAN - steps 1 to 3, and "What converting
                                          annotation and api-key found" findings 1, 6 and 7
dev/docs/adr/144-*.md                     the decisions, especially decision 2
packages/infrastructure/src/**            the member record as built: ProcessMembers,
                                          MemberName, reads(...), createProcessMembers
packages/infrastructure/tests/infrastructure-pool.unit.test.ts
                                          what the member record already guarantees
modules/annotation/server/src/**          a converted module with zero members
modules/api-key/server/src/**             a converted module with a bound credential
```

Start with `composition-v2.md` steps 1 to 3 and finding 1. Do not survey the
tree first - the plan already did that survey and the findings section records
what it got wrong.

## Target shape

`composition-v2.md` steps 1, 2 and 3 are the specification. In one line each:

- **Step 1** - the member record is already built and unit-tested in
  `@langwatch/infrastructure`. You are not rebuilding it. You are connecting it.
- **Step 2** - `defineServerModule` and the App's own `reads(...)`: a module
  declares the member names it reads, by name, and is refused by name at boot if
  the process did not configure one.
- **Step 3** - `createApp` takes members rather than a `Tier` and an
  `Infrastructure`.

What dies in this task:

- `Tier` (`"live" | "memory"`) as the thing `application.ts` is built around;
- `persistenceFor(pool)`, the inference from "a Prisma client happens to exist"
  to "the backend is Postgres". A process says which backend it composes; nothing
  infers it. This is ADR-144 decision 2 and it is the point of the task;
- `Infrastructure` as a separate concept from the member record, if steps 1 to 3
  leave it with nothing to hold.

`module-members.ts` already has the attribution layer - `MemberClaim`,
`buildClaimedMembers`, `membersFor`. `application.ts` imports it but **never
calls it**. Closing that gap is the core of this task.

## Invariants

- **Every currently booting process still boots.** This seam is under every
  application. A green package test here is not proof - see Checks.
- No module source and no composition root is edited in this task. If one must
  change for the seam to land, that is a finding: name it in the handoff and stop.
- A member a process did not configure is refused **by name**, at boot, not at
  first use, and not as `undefined`.
- No inference anywhere about which backend is in play. A process states it.
- The generator writes `modules/server-modules.generated.ts` (finding 7 - both
  the plan and ADR-144's first draft named the wrong path). If you wire anything
  to it, import from there.
- No `as unknown as`, no non-null `!`, no `ctx: unknown`, no inline `import()`.
- British English, no em dashes - write " - " instead.

## Checks

```
VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/runtime-composition test:unit
VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/infrastructure test:unit
rtk pnpm typecheck:one packages/runtime-composition        (once, at the end)
```

**And the one that actually matters:** boot a process against the new seam and
read the log. `api_boot=no-stack` at the time this manifest was written, so bring
the stack up first (`make haven up`) or say in the handoff that you could not,
and that the boot claim is therefore unproven. A `SyntaxError`, an
`ERR_MODULE_NOT_FOUND` or a fatal boot failure is the defect this task is most
likely to produce and the package suite will not show it.

## Stop conditions

- a shared path is needed;
- a module or a composition root would have to change for the seam to land;
- the plan's steps 1 to 3 turn out to disagree with the tree in a way the
  findings section did not record - write the new finding and stop;
- the budget is reached.

## Completion criteria

- `application.ts` composes through `createProcessMembers` / `buildClaimedMembers`
  rather than through `Tier` and `Infrastructure`.
- `persistenceFor(pool)` is gone, and nothing infers a backend from the presence
  of a client.
- A module can declare `reads(...)` and is refused by name at boot when the
  process did not configure that member, with a test proving the refusal.
- Both package suites pass and `typecheck:one` is clean.
- At least one process has been booted against the change and its log read - or
  the handoff says plainly that it was not, and why.
- The handoff names, per finding 6, which module should convert first to prove
  `reads(...)` in anger: one that genuinely reads a member.
