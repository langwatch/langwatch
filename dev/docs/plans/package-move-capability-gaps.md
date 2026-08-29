# Capabilities that did not survive their move into a package

A pattern, found while repairing test files that could not load. Each entry is
the same shape:

1. a component or surface is moved from `platform/app` into
   `packages/features/*`, re-authored rather than renamed;
2. something it did is not carried across — usually the part with the most
   intricate state;
3. the tests that would have caught it stop loading in the same move, or
   shortly after, so nothing goes red;
4. a later sweep deletes the now-unimported leftovers, which is correct on the
   evidence available and makes the gap permanent.

Nothing here is a criticism of the sweeps. Every individual commit was right on
what it could see. The gap is that step 3 hides step 2, so by the time a scan
runs, the only witness is already gone.

## Open

### The LangWatchQL workbench lost its granularity picker

Full write-up: [lwql-workbench-granularity-regression.md](lwql-workbench-granularity-regression.md).

A statement declaring `period_granularity_seconds` cannot be run from the
workbench: the surface asks the member to supply the value, and supplying it is
refused. The picker that used to answer it was dropped when the workbench was
re-authored into `@langwatch/analytics-web`, and its nine tests were dark
because a `./testing` export still pointed into a directory the colocation
commit had emptied.

### The run plan's folder grouping has no test, and its test names the wrong component

`caseFiling.integration.test.tsx` asserts that `ScenarioPicker` groups test
cases under their suite names, passing a `folders` prop. That prop has never
existed — not on the packaged `scenario-picker.tsx`, and not on the five-line
shim that preceded it. `git log -S folders` over both paths returns nothing.

The capability is real and lives elsewhere: `PlanScopeField`'s `CaseChoices`
builds one group per folder plus `PICKER_UNFILED_GROUP_NAME` for the unfiled
remainder. `PICKER_UNFILED_GROUP_NAME` is exported from the packaged picker and
used only by `PlanScopeField` — the constant travelled, the behaviour did not.

`PlanScopeField` has no tests at all.

The test is skipped rather than deleted, with the reason written at the skip.
Unskipping means driving `CaseChoices` through a `PlanEditorState`; it does not
mean adding `folders` to the picker.

## Closed

### The Langy Prisma repositories were unreachable

Three characterization suites imported
`@langwatch/langy-server/repositories/prisma/<file>`, a subpath in no exports
map. Fixed by adding the six they need to `./testing`, the surface that already
exists for test-only concrete access — not by publishing the directory, since a
repository is an implementation of a port and application code importing one
directly is how the port stops being the seam.

### `dashboardBelongsToProject` was swept while an integration suite still bound it

The suite binds the real predicate against real Postgres on purpose: a
repository whose tenancy is asserted against an in-memory fake asserts the
fake's `filter`. It looked unreferenced to a scan that reads only production
code. The predicate now lives at its one call site, which removes a
`platform/app` module rather than restoring one.

Checked at the same time: the other thirteen modules that sweep deleted break
no import.

## How to not add another

When a move re-authors rather than renames, diff the two files by *behaviour*,
not by size — the giveaway in both open cases above is a constant or a state
field that travelled while the control that drove it did not. `setGranularity`
with no caller outside its own unit tests, and `PICKER_UNFILED_GROUP_NAME`
exported from a component that never groups, are the same tell.
