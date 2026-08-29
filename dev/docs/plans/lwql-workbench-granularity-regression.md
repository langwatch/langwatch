# The LangWatchQL workbench lost its granularity picker

Found while repairing test files that could not load. Recorded rather than
fixed, because the repair is a careful port of revision-keyed state logic and a
half-correct one is worse than the gap.

## What a member sees

A statement that declares `{period_granularity_seconds:UInt32}` cannot be run
from the workbench at all.

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

## What the repair is

1. Port `LangWatchQLGranularityPicker` into
   `packages/features/analytics/web/src/components/`, reading the steps from
   one shared definition rather than the package's local copy.
2. Restore the `splitMissing` behaviour in `failureView`, so a reserved name
   reveals the control instead of being offered as a value to type.
3. Wire the picker to `controller.setGranularity`, porting
   `useWorkbenchGranularity` with its revision keying intact. Its comments name
   three traps worth reading before touching it: deriving "does it declare one"
   from the live outcome loops through the store; an answer from another
   revision resurrects the picker for a chart that never ran; and writing the
   shown step into the draft as the picker appears withdraws the very refusal
   that revealed it.
4. Restore the granularity scenarios to the packaged `.feature`, which is what
   the nine tests' `@scenario` annotations point at.
