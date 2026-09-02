# The LangWatchQL workbench lost its granularity picker

**Fixed.** Kept as the account of how it happened, because the shape recurs —
see [package-move-capability-gaps.md](package-move-capability-gaps.md).

Found while repairing test files that could not load, and recorded before it
was repaired: the port is revision-keyed state logic, and a half-correct one
would have been worse than the gap.

## What a member saw

A statement that declares `{period_granularity_seconds:UInt32}` could not be
run from the workbench at all.

The first run is refused with `lwql_parameter_missing` naming
`period_granularity_seconds` — that refusal is how the surface learns the
statement declares the step. The workbench lists the name among the parameters
to fill in. Typing it earns `lwql_reserved_parameter_supplied`, because the
step is the surface's to supply and never the member's. There is no third move.

## How it happened

Four commits, each defensible alone.

| commit | what it did |
| --- | --- |
| `40bca7acac` | built `LangWatchQLGranularityPicker` and wired it into the workbench |
| `df4f775bd2` | shipped the granularity contract end to end, spec scenarios included |
| `94b95128a0` | moved the workbench into `packages/features/analytics/web` — as a **new file**, not a rename |
| `cbcaf76802` | deleted 27 modules nothing imported, the now-orphaned picker among them |

The move re-authored the workbench (957 lines to 408) and did not carry the
picker. That left the picker imported by nothing, so the dead-code sweep was
correct on its own terms — the module really was unreachable.

## What survived, and what did not

The **state machine came across intact**. `packages/features/analytics/web`
still has `LangWatchQLRequestSnapshot.granularitySeconds`, a
`granularityChanged` action, and `controller.setGranularity(...)`, with unit
tests covering all of it. `setGranularity` has no caller outside those tests:
the logic is live and nothing drives it.

What did not come across:

- **the picker**, so no control calls `setGranularity`;
- **the reserved-name split.** The old `failureView` ran a missing-parameter
  refusal through `splitMissing`, offering the fillable names to the member and
  reading the reserved ones as the signal to reveal the picker. The packaged
  one assigns `failure.parameters` straight to `missingParameters`, which is
  the catch-22 above;
- **the spec.** `specs/analytics/lwql-workbench.feature` had granularity
  scenarios; `packages/features/analytics/specs/analytics-lwql-workbench.feature`
  has 29 scenarios and none of them mention it;
- **one definition of the contract.** The package re-declares
  `type LangWatchQLGranularityStep = 1 | 60 | 3600` rather than sharing
  `LWQL_GRANULARITY_STEPS` from `server/analytics/lwql/timeWindow`, which the
  picker deliberately imported from the leaf module for exactly this reason.

## Why nobody noticed

Nine tests in
`platform/app/src/features/analytics-query/__tests__/LangWatchQLWorkbench.integration.test.tsx`
assert the picker and the split, each annotated with the scenario it covers.
They have been dark since `5f9acf2b79`: that commit moved 1319 test files into
`__tests__` and rewrote their relative imports, but not the `./testing` subpath
in `@langwatch/analytics-web`'s `exports`, which still pointed into the emptied
`tests/`. The file could not load, so its failures never appeared. Repointing
that export (`d53944c22b`) is what surfaced them.

The server contract is untouched throughout: `timeWindow.ts` still declares the
parameter and the admitted steps, the REST door still threads it, and dashboard
widgets still set it. Only the authoring surface lost the ability.

## What the repair was

0. Move the vocabulary — the reserved names, the admitted steps, the
   predicates — into `@langwatch/analytics-contract`. It had to come first:
   the picker reads `LWQL_GRANULARITY_STEPS` as a value, and a packaged web
   component cannot import `~/server/…`. That is also what forced the
   package's duplicate `LangWatchQLGranularityStep` in the first place, so the
   move deleted the second copy rather than adding a third.
1. Port `LangWatchQLGranularityPicker` into
   `packages/features/analytics/web/src/ui/`, reading the steps from
   the one definition.
2. Restore the `splitMissing` behaviour in `failureView`, so a reserved name
   reveals the control instead of being offered as a value to type. On its own
   this unblocks nothing — with nowhere to supply the step, the member gets the
   same refusal, only clearer. It is necessary, not sufficient.
3. Wire the picker to `controller.setGranularity`, porting
   `useWorkbenchGranularity` with its revision keying intact. Its comments name
   three traps worth reading before touching it: deriving "does it declare one"
   from the live outcome loops through the store; an answer from another
   revision resurrects the picker for a chart that never ran; and writing the
   shown step into the draft as the picker appears withdraws the very refusal
   that revealed it. That last is why every Run goes through `granularity.run`
   rather than `query.runQuery`.
4. Restore the granularity scenarios to the packaged `.feature`, which is what
   the tests' `@scenario` annotations point at. Two of the five were already
   annotated by the packaged state-machine unit tests, aimed at scenarios the
   move had left behind — so the file went from binding none to binding all
   five.

Result: 30/30, from 21/30.

## One more thing the dark tests were hiding

Three of the nine did not fail on the missing picker. They read the mutation
mock's argument 1, which was the input while the harness stubbed an untyped
tRPC client (`mutation(path, input)`) and became the abort options once it
stubbed a typed one (`mutate(input, options)`). Other tests in the same file
were updated for that change; these were not, because they were not running.

That is the part that generalises. A dark test does not merely stop guarding —
it stops being maintained, so it collects further reasons to fail, and the
count you see on unskipping understates how long it has been broken.
