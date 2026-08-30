# Why test doubles keep drifting from the interfaces they stand in for

Six of them turned up in one pass through `src/server/app-layer`, all the same
shape: a double still spelling a method the real interface has renamed or
moved, failing at run time with `X is not a function` or a missing property.

- `resolveScope` → `tryResolveScope` (imperative permission facade)
- `load` → `tryLoad` (identity ledger's in-memory projection store)
- `ops.isAdmin` / `auth.revokeAllBrowserSessions` → `users.*` (user router)
- `sendEmail` → `mailer: EmailDeliveryPort` (report dispatcher)
- missing `evaluators` (evaluation execution deps)
- a hand-written price map instead of the catalogue (billing webhook)

## The claim I kept making, and why it was wrong

I wrote "tests are outside the typecheck people run" in several commits. Half
true, and the wrong half is the interesting one.

`pnpm typecheck` uses `tsconfig.tsgo.json`, which excludes `**/*.test.ts` and
`**/__tests__/**`. That is the one people iterate with, so it genuinely never
sees a double.

But `tsconfig.tsgo.tests.json` includes `./src/**/__tests__/**/*` explicitly,
and `pnpm typecheck:tests` / `typecheck:all` run it. Every one of the six
above IS covered. The check exists.

## Measured

```
$ pnpm --filter @langwatch/web typecheck:tests
1817 errors across 487 distinct files
```

(Count only lines carrying an `error TSxxxx` code. `tsc` also emits indented
"related information" lines naming other files, and counting those inflates
both the per-file totals and the file count — 1123 rather than 487, with
production modules appearing as top offenders when they are only being cited.)

Top codes: TS2339 (317), TS2740 (183), TS2304 (176), TS7006 (172).

At that volume the check cannot function as a guard. A new drift adds one line
to seventeen hundred, so it is invisible whether or not anyone runs it — and
the branch is mid-migration, so the count is not a surprise.

## What follows

1. **Run time is currently the only place a drift surfaces.** That is why all
   six were found by running suites rather than by checking them, and why a
   suite that cannot load hides its drifts completely: it fails at import and
   never reaches the assertion that would have named the method.
2. **The count is the thing to drive down**, not the individual drifts. Below
   some threshold `typecheck:tests` becomes a finder and the remaining ones
   fall out in a single pass; above it, they come one suite at a time.
3. **Do not cite "tests are not typechecked" as the reason** for a drift. The
   accurate reason is that the check covering them is red for unrelated
   reasons. The first framing suggests adding coverage that already exists.

The biggest single contributors are worth knowing before starting:
`governance-activity.integration` (81), `gateway-platform-api.integration`
(42), `budgetsEveryDimension.integration` (38), `inventory.enterprise.tsx`
(38), `dslAdapter.unit` (35), `savedWorkbenchChartsRestApi.integration` (30),
`budget.service.unit` (28).

Five of the top seven are gateway or governance suites, which suggests the
count is concentrated rather than uniform — a handful of subsystems mid-move,
not 487 independent problems.

## The top file, looked at

`governance-activity.integration.test.ts` — 81 errors, the largest single
contributor — is not a stub drift and will not fall to a rename.

Its 30 `TS2339`s name two methods:

- `app.projects.ensureInternal(...)` — `ProjectApp` has seven methods and this
  is not among them. The name appears nowhere in production code: only in this
  suite, in `internal-governance-project.integration.test.ts`, and in
  `test-utils/annotation-test-services.ts`, where it is stubbed as
  `unavailable`.
- `governanceService.summary(...)` — appears only in this suite.

So both are capabilities the tests expect and no class provides. That is the
absorbed-or-dropped question again, and answering it is governance's own work,
not a mechanical fix.

The remaining 50 errors are `TS7006` (implicitly-any parameters) and are almost
certainly downstream: a callback passed to a method that does not exist has no
contextual type. Expect them to clear with the 30, which is why the file's
count overstates its difficulty.

**These are integration suites.** They need Postgres and ClickHouse, so a
change to them cannot be verified by running them the way the unit-lane fixes
in this session were. Whoever takes it on should be able to run the datastore
lane, or the fix is being made blind.
