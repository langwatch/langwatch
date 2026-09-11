# Proposal: finish the composition migration on the worker

Measured at `e5a8a33d7c`, 2026-09-11. A proposal, not a decision - if accepted it
becomes an amendment to ADR-144.

## What the numbers say

The api migration is **done and proven**:

```
apps/api      1 composition file       183 lines   (was 4,989)
```

The worker migration has **barely started**:

```
apps/worker  64 composition files   13,725 lines
             worker-production.composition.ts alone   2,530 lines
                                                        120 local bindings
                                                        153 constructions
```

The worker has adopted half the mechanism and not the other half:

| | api | worker |
| --- | --- | --- |
| `withModules(...)` | yes | 9 files |
| `createProcess(...)` | yes | **0 files** |
| `serverModules` (generated list) | yes | **0 files** |
| hand-built module bags | none | **13 files** |

So the worker declares modules the new way but still builds every collaborator by
hand, from a member record it does not use, against a module list it does not
read.

## The claim

**The 184 bespoke collaborator fields are not a thing to design a seam for. They
are the mechanism by which the worker root stays at 13,725 lines, and they go
away when each module classifies its own internals.**

Fourteen modules declare a `<Module>Infrastructure` bag:

```
trace 29   automation 26   langy 21   gateway 14   evaluation 13
organization 12   coding-agent 9   github 6   entitlement 4   dashboard 4
topic 3   log 3   ...                                   184 fields total
```

Those fields are not infrastructure. Checked against `trace`, whose bag is the
second largest: all 30 interfaces are declared in `trace.members.ts` itself, and
of a sample of ten, **most have no implementation inside the module at all** -
the worker composition constructs them and hands them in. The ones that do have
an implementation live in `services/` (`TraceSpanNormalization`,
`TraceIoExtraction`) or `repositories/` (`TraceWindowedReadMetrics`). One
(`TraceQueryClassifier`) exists only as a test double.

That is a module whose own services are built by its caller. It is precisely the
inversion ADR-144 decision 2 refuses, and the bag is what carries it.

## Why this is now urgent rather than tidy

Three things that look separate are the same thing:

1. **Seven installation tests fail** on `.withInfrastructure(` with no
   replacement. Lane 2 stopped there: six of them need per-field decisions, not a
   rename.
2. **`packages/runtime-composition` will not typecheck** - the last three errors
   are a new `ModuleConfigGuard` refusing, at compile time, the bad config a test
   deliberately constructs to prove runtime rejection.
3. **The tree cannot reach zero dirty**, so the `origin/main` merge (85 commits
   behind, growing ~17/day) cannot start.

All three are downstream of the same unanswered question: *how does a module get
a collaborator that is not one of the fourteen canonical members?*

## Three answers, with their costs

### A. Per-module members slice - keep the bag, name it officially

A module declares `reads("<its own name>")` and the process supplies its bag as
one member. Five modules already read `members.<name>` this way.

- **Cost:** near zero. A rename and a declaration.
- **Unblocks:** everything, this week.
- **Buys:** nothing. `<Module>Infrastructure` survives with all 184 fields, the
  worker still hand-builds them, and the root stays at 13,725 lines. It is
  `withInfrastructure` with a new filename, and it makes ADR-144 decision 2
  unenforceable - the escape hatch is back, blessed.

### B. Classify every field, then delete the bags

Each of the 184 goes to one of five legal homes: a canonical member, a peer
`*Api`, a repository, a channel, or something the App derives itself.

- **Cost:** real. Fourteen module lanes, largest first, plus the worker
  compositions that stop constructing what they hand in.
- **Unblocks:** nothing this week. The seven tests stay red until their modules
  are done.
- **Buys:** the worker root collapses the way the api's did, and the guard
  becomes enforceable because there is nothing left to escape through.

### C. Classify, but ratchet - recommended

Do B, and make A the **transitional** state with a shrink-only counter, exactly
the mechanism that took `feature_shape_rows` from 392 to **0** on this branch.

- A module may keep its bag, declared honestly as `reads("<name>")`.
- Its field count goes in a baseline register that may only shrink.
- A new field is refused by lint. An existing one is paid down per lane.
- The bag's entry disappears when it reaches zero, and the module is done.

- **Cost:** A's cost now, B's cost spread over lanes.
- **Unblocks:** everything this week, honestly labelled.
- **Buys:** B's outcome, with a number that says how far along it is on any given
  day, and a guard that stops it going backwards while it gets there.

## Recommendation

**C.** The repository has already run this play once and won it: the
feature-shape baseline went 392 → 0 and the drive is finished. The same shape
applies, the tooling exists (`packages/architecture-lint/src/*-baseline.json`),
and the counter is one line in `shape-counters.sh`.

What C needs that does not exist yet:

1. `bespoke-members-baseline.json` - one row per module, its field count.
2. A lint rule refusing a new field in any `<Module>Infrastructure`.
3. `bespoke_member_fields=184` added to `shape-counters.sh`.
4. `reads("<name>")` legitimised for a module's own slice **only while it has a
   baseline row** - which is what keeps it transitional rather than permanent.

Point 4 is the load-bearing one. Without it, C decays into A.

## Sequencing

```
now      1. T1: application.ts onto the member record          opus
         2. the ratchet: baseline + lint rule + counter        sonnet
         3. the 7 installation tests, on their bags            sonnet
            -> tree reaches zero, merge can start
then     4. worker onto createProcess + serverModules          opus
         5. pay down the bags, largest first                   sonnet, one lane per module
            trace 29, automation 26, langy 21, gateway 14...
```

Steps 1 to 3 are the critical path and unblock the merge. Steps 4 and 5 are the
actual prize and can run for as long as they need to, because the ratchet means
they cannot silently stall.

## What would falsify this

- **If a field genuinely has no legal home**, the five categories are wrong and
  the vocabulary needs a fifteenth member name. That is a real possibility for
  telemetry-shaped fields (`traceEdgeMediaTelemetry`,
  `traceWindowedReadMetrics`); check them first, since they are the most likely
  counter-example and there are only a few.
- **If the worker's 13,725 lines are not mostly bag construction**, the headline
  is wrong. Sample `worker-production.composition.ts`'s 153 constructions before
  committing to step 4.
- **If `members.<name>` turns out to be load-bearing** for something other than
  the bags, A is not purely transitional and C needs rethinking.

## What this does not propose

The `ModuleConfigGuard` versus runtime-validation-test tension
(`define-feature.unit.test.ts:93`) is a separate, smaller decision: the test
constructs deliberately-bad config to prove runtime rejection, and the guard now
refuses it at compile time. Cast, `@ts-expect-error`, or loosen the guard - it
wants deciding, but it is not this proposal and it should not be bundled into it.
