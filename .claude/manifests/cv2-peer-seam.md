# Manifest: cv2-peer-seam

Objective: Give a module a way to be handed a peer's `*Api` without booting that
peer's whole dependency chain, replacing the removed `withProvided`.
Owner: unassigned
Model: opus for the seam's design and the first call site; sonnet for the
remaining mechanical repointing once the shape is proven and a handoff records it.
Budget: 100 tool calls (design lane); a repointing lane takes its own budget per
batch.
Handoff: .claude/handoffs/cv2-peer-seam.md
Depends on: cv2-application-member-record

## The problem, measured

`withProvided` is gone from `ApplicationBuilder` and nothing replaced it.
Measured at a08cbd27b8, source only:

```
112 call sites across 36 .ts files
```

(`composition-v2.md` finding 2 records 193 across 62, measured 2026-09-10. Take
your own measurement before you start and put both numbers in the handoff - a
count that moved on its own is worth knowing about.)

Every one of those names a method that no longer exists, and no converted
module's test can supply a peer without booting its whole chain.

## Owned paths - design lane

```
packages/runtime-composition/src/**        the seam itself
packages/runtime-composition/tests/**
packages/test-harness/src/**               if the test-facing half belongs there
```

**One** proving call site, which you name in the handoff before you change it.
Not thirty-six.

## Owned paths - repointing lane (a later, separate lane)

One batch of call sites per lane, named explicitly by file in that lane's own
manifest. Never "all files matching withProvided".

## Shared paths - stop and request

```
apps/api/src/app/api-production.composition.ts     coordinator
apps/worker/src/app/worker-tenancy*.composition.ts coordinator
packages/architecture-lint/src/*-baseline.json     coordinator
```

## Read-only reference paths

```
dev/docs/plans/composition-v2.md     finding 2, and the recipe's peer step
dev/docs/adr/144-*.md                decision 9 (the one channel-shaped seam actually built)
packages/eventing/src/pipeline/eventingModule.ts
                                     defineEventingModule / .withEventing - the ONE landed
                                     example of a seam of this shape, in production use by
                                     apiKeyServer. Copy its shape rather than inventing one.
modules/api-key/server/src/**        the module that uses it today
packages/test-harness/src/**         createApiFixture, the existing way a test supplies a double
```

`eventingModule.ts` is the exemplar. A second seam that does not look like it is
a finding, not a design choice.

## Target shape

A module declares the peers it needs; a process or a test supplies them by token;
neither has to construct the peer's dependency chain.

`createApiFixture<XApi>({ ...only the methods the test calls })` already exists in
`@langwatch/test-harness` and already throws by name on an uncalled method. The
test-facing half of this seam should be that, not a new double.

## Invariants

- The seam looks like `.withEventing(...)` / `defineEventingModule`, or the
  handoff says why it cannot.
- A peer arrives by its `*Api` token. No module imports another module's service,
  repository or app.
- A test can supply one peer without booting any other.
- The design lane changes exactly one call site. The other 111 are a later lane's
  work, in named batches.
- Identifier work goes through `tslsp-cli`, never grep or sed - 112 sites is
  exactly the scale where a sed pass silently eats a string in a `vi.mock`.
- After any rename, check `vi.mock("<path>")` strings and tests that read source
  as text by hand. The language server cannot see either.
- No `as unknown as`, no non-null `!`, no `ctx: unknown`.
- British English, no em dashes - write " - " instead.

## Checks

```
VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/runtime-composition test:unit
VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/api-key-server test:unit
rtk pnpm typecheck:one packages/runtime-composition       (once, at the end)
```

A repointing lane runs the owning package's suite for each batch it touches, and
nothing wider.

## Stop conditions

- a shared path is needed;
- the seam cannot be made to look like the eventing one;
- the measured call-site count differs from both recorded numbers by more than a
  handful - something else is moving, and you should say so before continuing;
- the budget is reached.

## Completion criteria

- The seam exists, with a unit test proving a peer can be supplied without
  booting its chain.
- Exactly one call site uses it, and passes.
- The handoff carries: both call-site measurements, the named batches for the
  repointing lanes, and the exact per-batch file lists so the coordinator can
  write those manifests without re-measuring.
- `typecheck:one packages/runtime-composition` is clean.
