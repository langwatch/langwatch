# The nightly suite

`.github/workflows/nightly.yml` runs every check too slow or too costly for a pull
request, once a night at 01:00 UTC, and reports them all on one pinned issue.
The behaviour is specified in `specs/ci/nightly-suite.feature`; this page is the
reasoning the scripts' headers point at.

## What runs

| job                                          | what it does                                                                                                                                                                                                     | goes red when                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `codebase-health`                            | `.github/workflows/codebase-health.yml`, called: type-check cost per program, typecheck time and memory, reference chain, declaration size, architecture findings, UI bundle, compared with 1, 7 and 30 days ago | the measuring breaks; a jump opens a `codebase-health` issue instead                            |
| `migration-compat`                           | `.github/workflows/migration-compat.yml`, called: the last release's image boots on the schema head migrated                                                                                                     | that image does not boot                                                                        |
| `npx-server-smoke`                           | `.github/workflows/npx-server-smoke.yml`, called: the packed server on every platform                                                                                                                            | it does not reach healthy                                                                       |
| `gateway-matrix`                             | `.github/workflows/gateway-matrix.yaml`, called: the AI Gateway against live providers                                                                                                                           | a provider scenario fails                                                                       |
| `hygiene-ts`, `hygiene-go`, `hygiene-report` | the whole-tree typecheck, oxlint plain and type-aware, every architecture policy, the pull request lint job's blocking checks, golangci-lint over every module with every linter                                 | something is new since last night (below)                                                       |
| `flaky-hunt`, `flaky-report`                 | every package suite three times, shuffled under three seeds, eight shards each                                                                                                                                   | a test is flaky that was not flaky last night                                                   |
| `upgrade-lab`                                | one upgradelab cell: the last release upgraded to head under traffic                                                                                                                                             | an invariant other than B1, N4 or an inconclusive I5 does not pass, or the cell could not judge |
| `dashboard`                                  | rewrites the pinned issue and raises failed jobs                                                                                                                                                                 | publishing fails                                                                                |

The four called workflows used to schedule themselves. They are reusable now
(`workflow_call`), keep their own manual and pull request or push triggers, and
have no schedule of their own.

## Concurrency

The nightly has no concurrency group. A group with `cancel-in-progress` would let
one nightly cancel another, and even without it GitHub cancels whichever run is
already pending in a group when a new one queues. The called workflows keep their
own groups, which cancel a run in progress only for a pull request or a branch
push. `gateway-matrix` keeps its shared group on purpose: it serialises spending
on the shared matrix keys, as its scheduled run always did.

## The dashboard

The pinned issue labelled `codebase-health-dashboard` was codebase health's own.
It is now the nightly dashboard (`.github/scripts/nightly-dashboard.ts`), written
through the same create-or-edit-and-pin code in `dev/scripts/codebase-health.mjs`:
a table of every job's outcome, then each report's section. GitHub refuses an
issue body over 65,536 characters, so sections are cut to a share of the space
when they would not fit, and say that the whole section is in the run's summary.
A failed job opens, or comments on, one issue labelled `nightly-regression`.

A run from any branch but the default one writes the dashboard to the run's
summary and touches no issue, so a trial dispatch cannot overwrite it.

## Earlier nights

Every report compares with earlier nights' artifacts. Since everything runs inside
the nightly, an earlier night is found by artifact name across the repository's
runs (`.github/scripts/nightly-artifacts.ts`), not by one workflow's run list. Only
default-branch runs count, so a branch dispatch never becomes main's baseline.
The artifacts compared over 30 days are kept for 35.

## Red only on something new

A nightly that fails every night on known debt is noise, so the hygiene report
(`.github/scripts/nightly-hygiene.ts`) shows the debt and fails only on:

- a rule whose count rose since last night;
- a rule with findings that had none last night;
- a pull request lint check that passed last night and fails tonight;
- a tool that produced no report. `dev/nx/lint.mjs` still prints its
  `N problem(s)` count when one of its oxlint processes failed, so that process's
  `oxlint -c <config> exited` line, captured with stdout, is what tells a crash
  from a clean tree. A typecheck that failed with no `error TS` line did not
  finish.

The first night with no previous report is the baseline and goes green. The
flaky-test hunt follows the same rule: only a test that was not flaky last night
turns it red.

## The flaky-test hunt

`.github/scripts/run-package-suites.ts` reads `PACKAGE_SUITES_VITEST_ARGS` and
`PACKAGE_SUITES_REPORT_DIR`. When set, a script whose last command is `vitest run`
gets the shuffle and seed arguments and a JSON report named after its package and
script; pnpm appends arguments to the end of a script, so a script that does not
end in vitest cannot take them and is not run in the hunt. Unset, the runner
behaves exactly as the pull request job runs it.

`.github/scripts/nightly-flaky.ts` reads every report: a test that failed in some
runs and passed in others is flaky, listed with the seeds and a command that
reruns its package's suite in the failing order. A test that failed in every run
is broken, not flaky, and is listed apart. A file that failed to load in one run
and loaded in another is flaky as a file.

## Typecheck trends under tsgo

TypeScript 7's compiler (tsgo, ADR-099) supports `--extendedDiagnostics` and
`--generateTrace`. Its trace differs from classic tsc's:

- it writes begin and end (`B`/`E`) pairs as well as complete (`X`) events, so
  durations come from pairing them per thread;
- it traces each file's check (`checkSourceFile`) and the type relations and
  variance computations inside it (`structuredTypeRelatedTo`,
  `getVariancesWorker`), but no per-expression events: the slowest expressions
  classic tsc traced (`checkExpression`, `checkVariableDeclaration`) do not exist,
  so the slowest top-level type relations stand in, resolved to the types and the
  lines that declare them;
- it writes one `types_<checker>.json` per checker, and paths lower-cased on a
  case-insensitive file system.

Both files run to hundreds of megabytes for a large program. They are read a line
at a time (tsgo writes one event or type per line) and only the top hot spots are
kept in `health.json`. The trace itself is not uploaded.

## The upgrade lab on a hosted runner

The cell (`tools/upgradelab`) expects haven's native Postgres and ClickHouse,
which haven manages through brew and which do not run on Linux. The job hands the
cell service containers instead (`-postgres-base`, `-clickhouse-base`), installs
`redis-server` for the cell to start its own, installs both checkouts itself
because the cell passes its children only a few environment variables, and
installs Chromium for its screenshots. The last release is the newest manifest in
`packages/upgrade/releases`, checked out at its `v<version>` tag.

B1 (headless Chromium has no WebGL) and N4 (`redis-cli --scan` reads fail) cannot
pass on a hosted runner until upgradelab itself changes, and I5 is inconclusive
because seed 1 has no open suite runs to count. The job's verdict
(`nightly-upgrade-lab.ts --verdict --known-failing B1,N4,I5:inconclusive`) leaves
those out. The section still lists them; any other result that is not `pass`,
or no verdict, is red.
