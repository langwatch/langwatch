Feature: One nightly suite runs the slow checks and reports them on one dashboard
  As a maintainer
  I want every check too slow or too costly for a pull request to run once a night
  So that I read one dashboard in the morning instead of five workflows, and a red
  run means something changed rather than that known debt is still there

  # Workflow: .github/workflows/nightly.yml. Scripts: .github/scripts/nightly-*.ts,
  # dev/scripts/codebase-health.mjs and dev/scripts/ts-program-metrics.mjs.
  # The typecheck-trend scenarios live in specs/tooling/codebase-health.feature,
  # because they extend that workflow rather than fork it.
  #
  # The first real run is the first 01:00 UTC after this lands on the default
  # branch: GitHub schedules only from the default branch's copy of a workflow.

  Rule: What runs when

    @unit
    Scenario: The nightly starts at 01:00 UTC and can be started by hand
      Given the nightly workflow
      Then it is scheduled at 01:00 UTC every day
      And it can be dispatched by hand on any branch

    @unit
    Scenario: The older nightly workflows run inside it and no longer schedule themselves
      Given codebase health, migration compatibility, the npx server smoke and the gateway matrix
      Then each is a reusable workflow the nightly calls
      And none of them carries a schedule of its own
      And each keeps the manual and pull request or push triggers it had

    @unit
    Scenario: A nightly run never cancels another run
      Given the nightly workflow and every workflow it calls
      Then the nightly has no concurrency group that cancels a run in progress
      And a called workflow cancels a run in progress only for a pull request or a branch push

    # Each called workflow is its own job: a red smoke does not stop the lint report.
    # Proved by a dispatched run, not by a unit test.
    @unimplemented
    Scenario: The nightly's jobs run side by side and one failing does not stop another
      Given a nightly run in which the npx server smoke fails
      Then the hygiene report, the flaky-test hunt, the upgrade lab and codebase health still run
      And the dashboard is still written after every job has finished

  Rule: One dashboard

    @unit
    Scenario: The dashboard shows every nightly job with tonight's outcome
      Given tonight's results for every nightly job
      When the dashboard is written
      Then it has one row per job with its outcome and what turns it red
      And each report's section follows the table
      And a job that left no report says so instead of leaving a gap

    @unit
    Scenario: A dashboard too long for an issue is cut, never refused
      Given sections that together exceed what an issue body can hold
      When the dashboard is written
      Then every section is cut at a line boundary to its share of the space
      And each cut section says the whole of it is in the run's summary

    @unit
    Scenario: A failed nightly job is raised as a regression issue
      Given the hygiene report and the gateway matrix failed tonight
      Then both are listed as failed jobs for the issue labelled "nightly-regression"
      And jobs that passed, were skipped or were cancelled are not

    @unimplemented
    Scenario: A run from a branch leaves the dashboard issue alone
      Given the nightly dispatched on a branch other than the default one
      When its dashboard job runs
      Then the dashboard is written to the run's summary
      And neither the pinned dashboard issue nor any regression issue is touched

  Rule: The hygiene and lint report counts debt and fails only on something new

    @unit
    Scenario: Lint findings are counted per rule with the files that carry most of them
      Given oxlint output with three findings of one rule in two files and an unused directive
      When the report is built
      Then the rule counts three findings with its heaviest file first
      And the unused directive is counted under its own name

    @unit
    Scenario: Typecheck errors are counted per error code in both compiler formats
      Given typecheck output in the parenthesised and in the colon form
      Then each "error TS" line counts once under its code and file

    @unit
    Scenario: Go lint findings are counted per linter
      Given golangci-lint JSON output with two misspell issues and one gosec issue
      Then misspell counts two and gosec counts one

    @unit
    Scenario: Architecture findings are counted per policy from the enforcer's summary
      Given the enforcer's summary with two findings of one policy and one of another
      Then each policy counts its findings
      And a summary of zero findings is a report with nothing in it
      But output with no summary line, such as a crash, is no report

    @unit
    Scenario: The first night is the baseline and goes green
      Given no report from last night
      When tonight's report is compared
      Then no rule is new and the report says tonight is the baseline

    @unit
    Scenario: A rule whose count rose goes red, one that held or fell does not
      Given last night's report with 10 findings of one rule and 5 of another
      When tonight there are 11 of the first and 2 of the second
      Then only the first is reported as new since last night

    @unit
    Scenario: A rule that appears for the first time goes red
      Given a rule with no findings last night
      When it has findings tonight
      Then it is reported as new tonight

    @unit
    Scenario: A check that passed last night and fails tonight goes red
      Given a pull request lint check that passed last night
      When it fails tonight
      Then it is reported as new since last night
      But a check that failed on both nights is shown and does not go red

    @unit
    Scenario: A tool that produced no report goes red rather than reading as clean
      Given a lint run that crashed before printing its findings
      Then the tool is reported as having produced no report
      And its rules are not compared, since tonight's zero means nothing

  Rule: The flaky-test hunt names tests that pass and fail on the same commit

    @unit
    Scenario: A test that failed in some runs and passed in others is flaky, with its seeds
      Given three shuffled runs of a package suite with seeds 11, 12 and 13
      When a test fails with seed 12 and passes with 11 and 13
      Then it is listed as flaky with seed 12 as the failing one
      And the rerun command names the package, the script and seed 12

    @unit
    Scenario: A test that failed every run is failing, not flaky
      Given a test that failed in all three runs
      Then it is listed as failing in every run and not as flaky

    @unit
    Scenario: A test file that failed to load counts as a failure of that file
      Given a test file that failed before any of its tests ran in one run only
      Then the file is listed as flaky

    @unit
    Scenario: A newly flaky test goes red, one already flaky last night does not
      Given last night's report listing one flaky test
      When tonight that test and another one are flaky
      Then only the other one is new

    @unit
    Scenario: A suite that wrote no report under some seeds is named with those seeds
      Given three shuffled runs in which one suite wrote a report under seed 11 only
      When the missing suites are listed
      Then that suite is named with seeds 12 and 13
      And a suite with a report under every seed is not listed

    @unit
    Scenario: The suite runner shuffles only scripts that end in vitest
      Given the hunt's shuffle and seed arguments
      Then a "vitest run" script receives them with a JSON report named after its package and script
      And a script whose last command is not vitest is not run in the hunt

    @unit
    Scenario: A suite's report name says which package and script to rerun
      Given a scoped package name and a script with a colon
      Then the report file name has no colon and reads back as the same package and script

  Rule: The upgrade lab upgrades a seeded deployment from the last release every night

    @unit
    Scenario: The upgrade lab's section shows the cell's verdict and what did not pass
      Given a cell report with one invariant that did not pass
      Then the section names the release it upgraded from, the verdict and the failing invariant
      But a cell that wrote no report says so and points at the job log

    @unit
    Scenario: Only an invariant outside the hosted runner's known failures turns the upgrade lab red
      Given B1 and N4 cannot pass on a hosted runner and I5 is inconclusive for seed 1
      When only B1 and N4 failed and I5 was inconclusive
      Then the upgrade lab stays green and its section still lists them
      But any other result that is not a pass, I5 failing outright, or a cell that could not judge turns it red

    # Not checkable by a unit test: it needs the hosted runner and two builds.
    @unimplemented
    Scenario: A representative cell runs on a hosted runner and keeps its evidence
      Given the newest release manifest names the last release
      When the cloud deployment at tier S with typical data and seed 1 is upgraded to head
      Then the cell's report, screenshots and logs are kept as the run's artifact
      And the job goes red when an invariant outside the known failures does not pass, or the cell could not judge

  Rule: Earlier nights are found by artifact, on the default branch only

    @unit
    Scenario: The comparison picks the newest default-branch artifact old enough
      Given artifacts from last night, six days ago, a month ago, a branch run and an expired one
      When the artifact at least six days old is asked for
      Then the six-day-old one from the default branch is chosen
      And tonight's own run, branch runs and expired artifacts are never chosen
