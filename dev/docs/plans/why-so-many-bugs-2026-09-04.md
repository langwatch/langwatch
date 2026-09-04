# Why the strict-layout branch shipped so many bugs, and the gate that stops it

Written 2026-09-04 after Alex's walk through the running product found fonts
missing, a duplicated settings sidebar, pages reading "does not exist", the
trace page spinning forever, enterprise menus on a free account and a run of
permission failures. Every one of those had a passing test somewhere. This
note names the causes with the evidence from the day, and the gate that is
now in force.

## The causes

### 1. The tests proved the pieces, never the product

The branch moved 166 pages and a few hundred services into feature packages.
Each move carried its unit and component tests, and each test mocks the
boundary it sits on: a host adapter test fakes the session port, a route
test fakes the service, a service test fakes the repository. All of them
were green while:

- the browser entry never imported `styles/globals.scss` (fonts, the CSS
  reset, link underlines), because the import lived in `platform/app`'s
  `main.tsx` and no test reads the entry file;
- every settings page wrapped itself in a second settings layout, because
  the page-level wrapper and the chrome's `NavigationShell` were each
  tested alone;
- twenty-two host adapters rendered a spinner forever on a refused
  organization graph, because their tests only covered `isLoading`;
- a bare `setQuery: route.setQuery` hand-off lost its receiver and threw on
  the first click of Add Model Provider, and three more hosts did the same
  with `feedback.succeeded`;
- a code evaluator could not be attached to a monitor, a test suite could
  not be listed or run over REST, and an evaluation recorded on a span
  came back as `[]`, each because two correct halves disagreed at a seam
  nothing exercised end to end.

The end-to-end journeys (browser, SDK, CLI) did not exist until this
evening. Their first runs found eleven product defects in a few hours,
which is the measure of what the unit and component suites could not see.

### 2. The type gate was hollow all day

Every lane and the root session verified packages with
`pnpm typecheck 2>&1 | grep 'error TS'`. tsc colourises its output, so
`error` and ` TS1234` are separated by escape codes and the grep never
matched. "Typecheck clean" was reported for packages carrying 59, 24, 23,
21 and 18 errors. The api's 18 included a `TS2304` on a symbol a merge had
half-reverted, which is exactly the class of fault the check exists to
catch. Found at 23:30 by the dissolution lane; recorded in memory and in
this note.

### 3. The tree was edited live under the person testing it

Up to fifteen lanes edited the worktree Alex ran `pnpm dev` against. Three
times today the api crash-looped on a half-applied composition edit (a
temporal dead zone, a trailing type-argument comma esbuild rejects, a
module a lane had just deleted). A page that "does not exist" was usually
an api that had not come back yet.

### 4. The counter that drove the work undercounted

The unbound-scenario figure reported every tick came from
`grep -c '✗ \['` on the parity report; the report's own summary line for
the same run was 50 percent higher (686 versus 1056). The direction of the
day's work was right, the scale was wrong, and two whole test trees
(`sdks/typescript/__tests__`, `dev/tests`) were not scanned at all.

### 5. Ports without a route to the product

Several behaviours main had were carried over as a port or a type with
nothing behind it: the Langy navigate fallback, the UI action runner, the
global upgrade modal, the reconciliation sweep on the migration pass, the
impersonation second factor. Their scenarios sat unbound, and nothing
in the composition refused by name, so the absence was silent.

## The gate

Nothing counts as done on this branch until all of the following hold, in
this order, and the counters are only reported after them:

1. **Typecheck read with colour stripped**, per package:
   `pnpm -s typecheck 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'error TS'`
   must print nothing, and the raw head has been looked at once.
2. **Boot smoke**: `PORT=5640 pnpm dev:api` logs `API HTTP listener
   started` and is killed again, after every composition edit.
3. **The three journeys run green** against a stack booted from the
   tree: `pnpm test:e2e --project=journey`, and
   `pnpm --filter langwatch test:e2e sdk-app cli-journey`. A product defect
   they find is recorded in `e2e-journey-2026-09-04.md` with a
   reproduction and fixed before the leg is touched.
4. **Parity is the summary line**, never a grep count, and every test
   tree is in `DEFAULT_TEST_ROOTS`.
5. **Absent behaviour refuses by name.** A port with no implementation is
   composed as a refusing adapter that names the absence, and its
   scenarios are listed in `binding-gaps-2026-09-04.md` until built.
6. **Lanes never edit the worktree a person is running.** Bug walks use a
   spare port slot or haven; lanes are told which files another lane holds.

## State at the time of writing

| Counter | Value |
|---|---|
| platform/app files | 0 |
| tRPC group halves left | 3 (identity, execution, org-group) |
| UI loader lines | 131 (end shape not yet designed) |
| Unbound scenarios (summary line) | 1011 |
| Browser journey | 9 of 13 legs green |
| SDK and CLI journeys | 27 of 32 green, 2 blocked on the outbox and evaluation fixes just landed |
| Commits behind origin/main | 0 |
