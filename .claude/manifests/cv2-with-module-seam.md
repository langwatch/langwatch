# Manifest: cv2-with-module-seam

Objective: `ApplicationBuilder` gains `withModule(module, { members })`, the per-module seam for a module's own collaborators, so a module whose bag is unsupplied refuses by name at boot instead of receiving `{}`.
Owner: cv2-with-module-seam
Model: opus   <the refusal semantics and the key name are decisions 10 test files and 6 worker roots inherit, and the current cast hides the failure until runtime>
Budget: 90 tool calls or 75 minutes, whichever comes first
Handoff: .claude/handoffs/cv2-with-module-seam.md

## Why this exists (read this first - it is not the premise you will infer)

`.withInfrastructure(bag)` was deleted. The thing meant to replace it,
`withModule(module, { members })`, was **never implemented**. It is called from
ten sites today and defined nowhere:

- `packages/architecture-lint/src/policies/feature-shape.ts:83` documents
  `createApp(...).withModule(<feature>Server).boot()` as the canonical boot shape.
- Four tests call it with the key `members:`
  (`monitor`, `feature-flag`, `gateway`'s elevenlabs-webhook integration test).
- Six `apps/worker/src/app/*.composition.ts` roots call it with the key
  `infrastructure:` - the older name for the same bag. `*.infrastructure.ts` is
  being renamed to `*.members.ts` across the tree, so these are the same seam
  spelled two ways.

`reads()` in `packages/infrastructure/src/members.ts:175` is bounded to
`MemberName` - the 14 canonical process members. A module's OWN collaborators
(`DashboardInfrastructure`, `WorkflowInfrastructure`, ...) are not among them and
never can be. They are the second type parameter of
`FeatureSetup<Dependencies, Members, Config, Repositories>` - per-module, not
process-wide. `withModule` is how a process supplies them.

**The defect that hid this.** `application.ts:443` reads:

    members: membersFor(members, declaration.requiredMembers) as Members,

`membersFor` returns a view of only the `reads()` names. A module whose `Members`
slot is its own bespoke bag therefore receives a frozen `{}` **cast** to that bag
type: compiles clean, every collaborator `undefined` at runtime. That is why
`user-installation` fails with `Cannot read properties of undefined` and why
nothing refused. Removing that cast, or making it honest, is part of this task.

## Owned paths

    packages/runtime-composition/src/application.ts
    packages/runtime-composition/src/module-members.ts
    packages/runtime-composition/src/index.ts
    packages/runtime-composition/src/__tests__/**

`application.ts` and `index.ts` are **already dirty** with green typed-config
work (`ApplicationOptions<Members, Config>`, ruling 19). Build on that state. Do
not revert it and do not commit.

## Shared paths - stop and request

    apps/worker/src/app/*.composition.ts                 coordinator
    apps/worker/src/app/worker-tenancy*.composition.ts    coordinator
    apps/api/src/app/api-production.composition.ts        coordinator
    packages/infrastructure/src/members.ts                coordinator
    packages/architecture-lint/src/**                     coordinator
    modules/**                                            other lanes

You may READ every one of them. You may edit none. In particular: do not convert
a single module test or worker composition root. Ten of them are waiting on this
seam and they are other lanes' work - your deliverable is the seam plus its own
tests.

## Read-only reference paths

    modules/monitor/server/src/app/__tests__/monitor-installation.unit.test.ts:18-32
        the `members:` call shape, with four bespoke collaborators
    modules/feature-flag/server/src/app/__tests__/feature-flag-installation.unit.test.ts:16-29
        the same, and it also passes `config` inside the same bag - decide whether that is allowed
    apps/worker/src/app/worker-tenancy.composition.ts:86-98
        the `infrastructure:` call shape, seven bespoke collaborators
    packages/runtime-composition/src/module-members.ts:50-66
        `membersFrom`, the process-wide source, and the refusal it documents
    packages/runtime-composition/src/module-members.ts:129-136
        `membersFor`, the per-module view that is currently cast away
    packages/runtime-composition/src/feature-installer.ts:34-47
        `FeatureSetup`, whose second slot is the bag you are supplying

## Target shape

`withModule` installs exactly one module and carries that module's own member
bag. Sketch, not a specification - the types are yours to get right:

    withModule<Module extends InstallableServerFeature<...>>(
      module: Module,
      options?: { readonly members?: <the module's own Members> },
    ): ApplicationBuilder<Members, Rest, Trpc, Config>

`withModules([...])` keeps its current meaning and stays. `withModule(m)` with no
bag must behave exactly as `withModules([m])` does today.

## The three decisions this lane owns

Record each one in the handoff with the reasoning, not just the choice.

1. **The key.** `members:` (4 tests) or `infrastructure:` (6 worker roots)? The
   tree is mid-rename from `infrastructure` to `members`; pick the destination
   name and say so, and note in the handoff that the six worker roots then need
   the other spelling repointed by their owning lane. Do not repoint them
   yourself. Accepting both is a third option - argue it or reject it explicitly.

2. **Refusal for an unsupplied bespoke bag.** A module whose `Members` slot needs
   collaborators and whose `withModule` bag omits them must fail **by name**, the
   way `MissingMemberError` already does for a canonical member. Decide whether
   that is compile-time, boot-time, or both. "Receives `{}` and crashes later" is
   the current behaviour and is the bug.

3. **The cast at `application.ts:443`.** Make it honest. A per-module bag and a
   process-member view now both feed `setup.members`; state how they combine and
   whether a name may appear in both.

If a decision turns out to need `packages/infrastructure/src/members.ts` to
change, stop and write it into section 10 - that file is the coordinator's.

## Invariants

- `withModules`, `withProvided`, `withTransports`, `withService` and `boot` keep
  their current signatures and behaviour. Every existing call site still compiles.
- A canonical member absent from the process source still raises
  `MissingMemberError` naming the module and the member.
- The typed-config work already in the working tree stays. `pnpm typecheck:one
  packages/runtime-composition` is green now - it is green when you finish.
- No new dependency.
- Do not delete a test to make a check pass.

## Checks

    rtk pnpm typecheck:one packages/runtime-composition
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/runtime-composition test:unit

Then, as evidence the seam works, and **without editing either file**:

    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/monitor-server test:unit src/app/__tests__/monitor-installation.unit.test.ts
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/feature-flag-server test:unit src/app/__tests__/feature-flag-installation.unit.test.ts

Both fail today with `withModule is not a function`. If your seam is right and
the key you chose is `members:`, both should pass with no change to either test.
That is the completion signal. If they fail for a reason inside the module rather
than the seam, say so and leave them failing - they are not yours to fix.

Never a whole-tree check. Never `pnpm typecheck`.

## Stop conditions

- `packages/infrastructure/src/members.ts` needs to change
- a decision above cannot be made from the tree without guessing
- the budget is reached
- a module file would have to change to prove the seam

## Completion criteria

- `withModule(module, { <chosen key> })` exists on `ApplicationBuilder`, typed,
  with a doc comment saying what the bag is and why it is per-module
- `withModule(m)` with no bag is equivalent to `withModules([m])`
- a unit test covers: bag supplied and reaching the App; bag omitted for a module
  that needs one, refusing by name; `withModule` with no bag for a module that
  needs none
- the `as Members` cast at the old `application.ts:443` is gone or justified in a
  comment that says why it is sound
- `rtk pnpm typecheck:one packages/runtime-composition` clean
- `@langwatch/runtime-composition` unit tests green, none deleted or skipped
- `monitor-installation` and `feature-flag-installation` pass unedited, or the
  handoff says which module-side reason stops them
- the three decisions are written down in the handoff with reasoning
