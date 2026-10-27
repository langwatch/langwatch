Feature: A nightly run catches codebase health regressions the next morning
  Type-check cost, reference-chain depth, emitted declaration size and
  architecture findings drift one commit at a time, and nobody sees the jump
  until the editor is slow. `.github/workflows/codebase-health.yml` measures
  them each night with `dev/scripts/codebase-health.mjs`, compares with the
  previous night's `health.json`, and raises a jump as an issue
  labelled `codebase-health`. It also measures the UI bundle and the time of the
  repo-scanning suites, and survives a failing typecheck. Every metric, with its
  change against 1, 7 and 30 days ago, is its section of the one pinned issue
  labelled `codebase-health-dashboard`, which the nightly suite rewrites each
  night (specs/ci/nightly-suite.feature).

  The workflow runs inside the nightly suite, which is why the older nights are
  found by artifact name rather than by this workflow's own runs.

  @unit
  Scenario: The first run has nothing to compare with
    Given no previous health.json
    When the health of tonight's run is compared
    Then no breach is reported
    And the summary says there is no previous run

  @unit
  Scenario: A program whose instantiations rise past both thresholds is a breach
    Given a program with 400000 instantiations last night
    When it has 600000 tonight
    Then the program is reported as a breach
    But a program rising from 1000 to 90000 is not, being under the 100000 floor

  @unit
  Scenario: Total instantiations up more than ten per cent is a breach
    Given 1000000 instantiations in total last night
    When the total is 1150000 tonight
    Then the total is reported as a breach

  @unit
  Scenario: A longer reference chain is a breach
    Given a longest reference chain of 17 configs last night
    When it is 18 tonight
    Then the chain depth is reported as a breach

  @unit
  Scenario: Any new architecture finding is a breach
    Given 0 "peer-cycles" findings and 3 "cycles" findings last night
    When there is 1 "peer-cycles" finding and 4 "cycles" findings tonight
    Then both policies are reported as breaches
    But a policy whose count fell is not

  @unit
  Scenario: Declaration size up more than ten per cent, or a new large file, is a breach
    Given 10 MB of emitted declarations last night and no file over 200 KB
    When there are 11.5 MB tonight and one file of 250 KB
    Then the total size and the new large file are both reported as breaches

  @unit
  Scenario: A breach opens an issue when none is open
    Given tonight's comparison has a breach
    And no open issue carries the "codebase-health" label
    Then an issue titled "Codebase health: <date> regressions" is opened with the table

  @unit
  Scenario: A breach comments on the open issue
    Given tonight's comparison has a breach
    And issue 42 is open with the "codebase-health" label
    Then the table is posted as a comment on issue 42 and no new issue is opened

  @unit
  Scenario: No breach does nothing
    Given tonight's comparison has no breach
    Then no issue is opened and no comment is posted

  @unit
  Scenario: A failing typecheck is a breach and the other metrics are still compared
    Given the root typecheck exited non-zero with 3 "error TS" lines in its log
    When the health of tonight's run is compared with a previous run
    Then "typecheck failed on main: 3 errors" is reported as a breach listing the first error lines
    And an architecture finding that rose is still reported as a breach

  @unit
  Scenario: Time and memory from a failed typecheck are not compared
    Given the root typecheck exited non-zero
    Then its wall time and peak memory are recorded as unavailable
    And the summary does not present them as a change

  @unit
  Scenario: A passing typecheck reports no typecheck breach
    Given the root typecheck exited with 0
    Then no typecheck breach is reported

  @unit
  Scenario: Total JS or entry gzip up more than ten per cent is a breach
    Given 10 MB of UI JavaScript and a 300 KB gzipped entry chunk last night
    When there are 11.5 MB tonight
    Then the total JavaScript is reported as a breach
    And an entry chunk of 340 KB gzipped is reported as a breach too

  @unit
  Scenario: A new chunk over 500 KB is a breach, a known large one is not
    Given a 600 KB chunk named "vendor" last night
    When tonight has "vendor" under a new hash and a new 700 KB chunk "charts"
    Then only "charts" is reported as a breach

  @unit
  Scenario: A failed UI build is a breach
    Given the UI build exited non-zero
    Then "UI build failed" is reported as a breach
    And no bundle size is compared

  @unit
  Scenario: Bundle sizes are measured from the built output
    Given a build directory with an entry script, a lazy chunk and a stylesheet
    Then the totals, the gzipped entry size and the largest chunks are reported

  @unit
  Scenario: A missing build output is not a bundle of zero bytes
    Given a build directory that does not exist
    Then no bundle is recorded and no bundle breach is reported

  @unit
  Scenario: The dashboard shows tonight, last night, a week ago and a month ago
    Given tonight's health, last night's, one from a week ago and one from a month ago
    Then the dashboard section has a row per metric with tonight's value and its three changes
    And it links the open breach issues

  @unit
  Scenario: The dashboard copes with no older runs
    Given no previous run and no run from a week ago
    Then the dashboard body still renders with n/a in the comparison columns

  @unit
  Scenario: The dashboard issue is created when absent and edited when present
    Given no open issue labelled "codebase-health-dashboard"
    Then the plan is to create one titled "Nightly dashboard"
    But when issue 7 carries the label the plan is to edit issue 7's title and body, not comment

  Rule: Typecheck trends per program

    # TypeScript 7's compiler (tsgo, ADR-099) supports --extendedDiagnostics and
    # --generateTrace. Its trace has each file's check and the type relations
    # inside it, but no per-expression events, so the slowest type relations
    # stand in for the slowest expressions classic tsc used to trace. The trace
    # itself is not kept: it runs to hundreds of megabytes per program.

    @unit
    Scenario: The compiler's extended diagnostics are read per program
      Given the extended diagnostics a program's check printed
      Then its files, symbols, types, instantiations, memory and check time are recorded

    @unit
    Scenario: The trace is summarised into the slowest files and type relations
      Given a trace with begin and end events per file and nested type relations
      When it is summarised
      Then the slowest files to check are listed slowest first
      And only the outermost type relations are listed, resolved to the types and lines that declare them

    @unit
    Scenario: Each program records instantiations, check time, memory, types and symbols
      Given a program's measured numbers and hot spots
      When tonight's health is built
      Then the program keeps every number and its five hottest files and relations

    @unit
    Scenario: Each program is compared with itself 1, 7 and 30 days ago
      Given the heaviest programs tonight and the same programs on older nights
      Then the trend table shows each program's change in instantiations and check time against each older night
      And n/a where an older night did not measure it
      And the hot spots are listed under each program
