Feature: A package's integration suite runs in CI when it declares one
  As an engineer who split a package's tests into two vitest lanes
  I want CI to run both lanes
  So that the split does not quietly become a place where tests go to stop running

  # `.github/scripts/run-package-suites.sh` discovers workspace packages and runs
  # one script each: `test:unit` where a package draws the distinction, `test`
  # otherwise. Most packages are fine with that — a bare `vitest run` collects
  # `*.unit.test.ts` and `*.integration.test.ts` alike.
  #
  # A package that wants its integration files under a DIFFERENT vitest — serial
  # forks against one shared datastore instead of a concurrent pool — has to
  # exclude them from the first script and name a second. Discovery never asked
  # for the second one, so the exclusion landed and the lane did not:
  # `@langwatch/trace-server` ran `vitest run --exclude '**/*.integration.test.ts'`
  # under both of its script names, and its four integration suites ran in no job
  # at all. Nothing went red, because a suite CI never starts cannot fail.
  #
  # `@langwatch/coding-agent-server` shows the second shape of the same silence:
  # it DID declare `test:integration`, and the config behind it named one literal
  # file path that had since moved. Nothing ran that script either, so the rot
  # was invisible — and the moment discovery asks for it, vitest exits 1 with
  # "No test files found". A declared lane pointing at a moved file is a job
  # that goes red the day someone wires it, which is why the glob and the
  # wiring have to land together.
  Background:
    Given the workspace membership is discovered from pnpm rather than a hand-written list
    And the two registers gate a package rather than one of its scripts

  Rule: Both lanes run, and neither is optional

    @unit @regression
    Scenario: A package that declares an integration suite has it run
      Given a package declares a test script and a test:integration script
      When the package suites job runs
      Then both scripts are run for that package

    @unit
    Scenario: A package whose only suite is an integration suite is still discovered
      Given a package declares a test:integration script and no other test script
      When the package suites job runs
      Then its integration script is run

    @unit
    Scenario: A failing integration suite fails the package and names the script
      Given a package whose unit suite passes and whose integration suite fails
      When the package suites job runs
      Then the job fails
      And the failure names the integration script rather than the unit script

    @unit
    Scenario: An excluded package runs neither of its suites
      Given a package is registered as covered by another workflow
      And it declares both a unit and an integration script
      When the package suites job runs
      Then neither script is run

