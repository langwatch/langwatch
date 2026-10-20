Feature: A package's integration suite runs in CI when it declares one
  As an engineer who split a package's tests into two vitest lanes
  I want CI to run both lanes
  So that the split does not quietly become a place where tests go to stop running

  # `.github/scripts/run-package-suites.ts` discovers workspace packages and runs
  # one script each: `test:unit` where a package draws the distinction, `test`
  # otherwise. Most packages are fine with that — a bare `vitest run` collects
  # `*.unit.test.ts` and `*.integration.test.ts` alike.
  #
  # A package that wants its integration files under a DIFFERENT vitest — serial
  # forks against one shared datastore instead of a concurrent pool — has to
  # exclude them from the first script and name a second. Discovery never asked
  # for the second one, so the exclusion landed and the lane did not:
  # `@langwatch/trace-process` ran `vitest run --exclude '**/*.integration.test.ts'`
  # under both of its script names, and its four integration suites ran in no job
  # at all. Nothing went red, because a suite CI never starts cannot fail.
  #
  # `@langwatch/coding-agent-process` shows the second shape of the same silence:
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


  Rule: The suites are split across runners without losing one

    @unit
    Scenario: Every package lands on exactly one shard
      Given the package suites job is split into several shards
      When every shard takes its share of the discovered packages
      Then each package is run by exactly one shard

    @unit
    Scenario: Shards are balanced by measured weight
      Given a weights file recording how many seconds each slow package takes
      When the packages are split over the shards
      Then the heaviest packages are placed first, each on the shard with the least weight so far

    @unit
    Scenario: Every shard computes the same split
      Given the same packages and the same weights file
      When two shards each compute the split in their own process
      Then they agree on which shard runs every package

    @unit
    Scenario: A package with no recorded weight still lands on a shard
      Given a package the weights file does not name
      When the packages are split over the shards
      Then it is weighed at the default and run by exactly one shard

    @unit
    Scenario: A malformed weights file is refused
      Given a weights line that is not "<package>  <seconds>" with a positive number
      When the package suites job starts
      Then it fails instead of splitting by guesswork

    @unit
    Scenario: A malformed shard value is refused
      Given PACKAGE_SUITES_SHARD is not "<index>/<total>"
      When the package suites job starts
      Then it fails instead of running every package on every shard

  Rule: A pull request runs the suites its change reaches

    @unit
    Scenario: A pull request runs only the suites its change reaches
      Given the affected job lists the projects a pull request reaches
      When the package suites job runs
      Then only the packages in that list are sharded and run

    @unit
    Scenario: A pull request balances over only the packages it reaches
      Given the affected job lists a few projects
      When those packages are split over the shards
      Then the weights of the unaffected packages play no part in the split

    @unit
    Scenario: Without an affected list every suite runs
      Given a push to main, a merge group, a global input change or a failed affected step
      When the package suites job runs
      Then every discovered package is sharded and run

  Rule: A shard runs several suites at once without letting them collide

    # Most suites run on a single vitest worker, so a shard that ran them one
    # after another kept three of a runner's four cores idle. Integration suites
    # stay one at a time because their files share one datastore and run serially
    # for that reason. Browser suites stay one at a time because each installs its
    # browser through apt, which holds a machine-wide lock. Each suite's output is
    # held back and printed as one group when it ends, so two never interleave.

    @unit
    Scenario: A shard runs several suites at once
      Given a shard with more suites than its concurrency
      When the package suites job runs
      Then up to that many suites run at the same time

    @unit
    Scenario: Only one integration suite runs at a time
      Given two packages that each declare an integration suite
      When the package suites job runs them concurrently
      Then their integration suites never overlap

    @unit
    Scenario: Only one browser suite runs at a time
      Given two packages that each declare a browser suite
      When the package suites job runs them concurrently
      Then their browser suites never overlap

    @unit
    Scenario: Only one heavy suite runs at a time
      Given two packages whose recorded weight marks them as heavy
      When the package suites job runs them concurrently
      Then they never overlap, and light suites run alongside them

    @unit
    Scenario: A package's own suites run one after another, in order
      Given a package with a unit suite and an integration suite
      When the package suites job runs concurrently
      Then its integration suite starts only after its unit suite finished
      And a later suite of the package never overtakes one waiting for its slot

    @unit
    Scenario: A suite's output is printed as one group when it ends
      Given two suites that print while both are running
      When each of them ends
      Then each suite's output is printed as one group, never interleaved

    @unit
    Scenario: A cancelled run prints what its unfinished suites said
      Given a suite that is still running when the run is cancelled
      When the runner flushes on cancellation
      Then what that suite printed so far appears once, as an unfinished group

    @unit
    Scenario: Without a concurrency setting the suites run one at a time
      Given PACKAGE_SUITES_CONCURRENCY is not set
      When the package suites job runs
      Then each suite runs alone, as before

    @unit
    Scenario: A malformed concurrency value is refused
      Given PACKAGE_SUITES_CONCURRENCY is not a positive whole number
      When the package suites job starts
      Then it fails instead of guessing how many suites to run at once
