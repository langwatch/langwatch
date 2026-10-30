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
      Then the heaviest packages are placed first, each on the shard whose wall time it raises least

    # A shard's wall time is its heavy suites, which run alone, plus its light suites
    # over the concurrency, unless its integration and browser suites, one at a time,
    # take longer. Measured on main that model was within 1% of every shard; adding the
    # two lanes together changes no shard's figure under today's weights. Balancing raw
    # seconds instead let one shard run 1073s while another ran 473s.
    @unit
    Scenario: Shards are balanced by the wall time each package adds
      Given a heavy package that runs alone and light packages that share the shard
      When the packages are split over the shards
      Then a heavy package counts for all of its seconds and a light one for its share of the concurrency
      And a shard's integration and browser lanes count at full weight, added together, one suite at a time

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

    # The patched vitest launcher gives each suite two workers, so a shard that ran
    # them one after another left half of a runner's four cores idle. A heavy suite
    # runs alone: design-system's story tests time out under any CPU sharing.
    # Integration suites
    # stay one at a time because their files share one datastore and run serially
    # for that reason. Browser suites stay one at a time because each installs its
    # browser through apt, which holds a machine-wide lock. Each suite's output is
    # held back and printed as one group when it ends, so two never interleave.
    #
    # A browser suite never runs beside an integration suite either. In CI an integration
    # suite starts containers, each adding a network interface. Chromium aborts every
    # request in flight with ERR_NETWORK_CHANGED when the interfaces change, so a browser
    # suite failed with "Failed to fetch dynamically imported module": five runs in five
    # on one pull request whose shard put the two side by side.

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

    @unit @regression
    Scenario: A browser suite never runs beside an integration suite
      Given one package that declares a browser suite and another that declares an integration suite
      When the package suites job runs them concurrently
      Then the browser suite and the integration suite never overlap
      And the unit suites still run alongside either of them

    # The rule above covers a suite's containers only while the suite runs. Ryuk removed
    # a suite's leftover containers, and itself, about ten seconds after the suite exited,
    # when a browser suite may have started. With Ryuk off, a suite stops its own containers
    # or reuses them (clickhouse-test-endpoints.ts), and those run until the runner ends.
    @unit @regression
    Scenario: No container is removed after its suite has ended
      Given testcontainers' Ryuk removes a suite's leftover containers after the suite exits
      When the package suites job starts any suite
      Then the suite runs with Ryuk turned off

    @unit
    Scenario: A heavy suite runs alone
      Given a shard with packages whose recorded weight marks them as heavy
      When the package suites job runs concurrently
      Then no other suite runs while a heavy suite runs
      And every heavy suite starts before any light one

    # Alone with the launcher's two workers, a heavy suite left half of a
    # four-core runner idle, and heavy suites are about half of a shard's work.
    @unit
    Scenario: A heavy unit suite running alone uses every core
      Given a heavy package's unit suite on a runner with four cores
      When the package suites job starts it
      Then it runs with four workers

    @unit
    Scenario: A heavy suite that needs a quiet CPU keeps the launcher's workers
      Given design-system's suite, or a heavy package's integration or browser suite
      When the package suites job starts it
      Then it keeps the worker count its config and the launcher give it

    # A heavy suite has its shard to itself, so one whose files are isolated by
    # construction can use the cores the rule leaves idle. @langwatch/analytics-process's
    # integration lane spent 270 to 400s standing up a container and a database per
    # file, two files at a time.
    @unit
    Scenario: A heavy integration suite whose files are isolated runs more of them at once in CI
      Given an integration suite whose files cannot see one another's state
      When its config asks for three workers and it runs in CI
      Then its files run three at a time, with concurrency asked for by name
      And off CI the launcher's own worker count stands
      And a worker count exported on purpose, other than the launcher's default, stands

    @unit
    Scenario: A shard starts its heaviest suites first
      Given a shard whose packages differ in recorded weight
      When the package suites job runs
      Then it starts them heaviest first, so a long suite does not run alone at the end

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

  Rule: An unchanged suite replays its pass instead of running again

    @unit
    Scenario: A suite Nx caches runs through Nx
      Given a package whose suite script is one nx.json caches
      When the package suites job runs it
      Then it runs through Nx, so an unchanged suite replays its recorded pass

    @unit
    Scenario: An integration or browser suite runs uncached
      Given a package's integration or browser script
      When the package suites job runs it
      Then it runs through pnpm, every time

  # Bound by tools/ciguard/mainsuites_test.go (the workflow's shape) and
  # tools/slacknotify/slacknotify_test.go (the post) (#9146).
  Rule: Main runs every suite in one job and tells Slack when it fails

    @unit
    Scenario: A push to main runs the package suites as one job
      Given a merge to main
      When langwatch-app-ci runs for that commit
      Then package-suites runs as one job holding every suite
      And a newer merge waits for that run instead of cancelling it
      And a pull request still splits its suites over eight jobs

    @unit
    Scenario: A red package-suites run on main posts to Slack
      Given package-suites fails or times out on main and was not red in the previous finished run
      When the run reaches its Slack job
      Then Slack gets the job, the commit and a link to the run

    @unit
    Scenario: A repeat failure or timeout on main posts once
      Given package-suites failed or was cancelled in the previous finished run on main
      When it is red again
      Then Slack gets nothing new
