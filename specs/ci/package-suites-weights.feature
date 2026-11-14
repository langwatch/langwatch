Feature: The package-suites weights are refreshed by a command
  As a developer waiting on the package-suites shards
  I want the weights that split them to be measured, not pasted by hand
  So that the run is not paced by a shard whose packages grew since the last paste

  # `.github/package-suites.weights` used to be refreshed by opening a green
  # main run's eight job summaries and pasting their blocks. Nobody did, and
  # the file drifted: trace-browser was listed at 595s and measured 213s, and
  # workflow-process was listed at 51s and measured 151s. `go run
  # ./cmd/suiteweights` reads the same numbers out of the job logs instead.
  #
  # The file is still committed and read from the checkout, never fetched by a
  # shard (specs/ci/shard-duration-weights.feature): every shard must compute
  # the same split. The command is how a person refreshes it, not something the
  # job runs.

  Rule: a weight is what a suite costs when it really runs

    @unit
    Scenario: A script's seconds are read from the job log
      Given a package-suites job log
      When it is read
      Then each package script it ran is measured in the seconds its group header names

    @unit
    Scenario: A suite Nx replayed from its cache does not make it look cheap
      Given a script Nx replayed from its cache in one run and ran for real in another
      When the weights are computed
      Then only the real run's seconds count

    @unit
    Scenario: A suite only ever replayed from the cache still has a weight
      Given a script Nx replayed from its cache in every run
      And the committed weights file does not name its package
      When the weights are computed
      Then its replayed seconds are its weight

    @unit
    Scenario: A package only ever replayed from the cache keeps its committed weight
      Given a package every sampled run replayed from the cache
      And the committed weights file names it
      When the weights are computed
      Then it keeps the committed weight rather than the replay's seconds

    @unit
    Scenario: A script no run measured keeps its committed weight
      Given the committed weights file names a script of a package that some run measured
      And no sampled run measured that script
      When the weights are computed
      Then the script keeps its committed weight
      And a package no run measured is dropped

    @unit
    Scenario: A committed script its package no longer defines is dropped
      Given the committed weights file names a script of a package that some run measured
      And that package's package.json no longer defines the script
      When the weights are computed
      Then the script is dropped rather than carried forward

    @unit
    Scenario: A measured script its package no longer defines is dropped
      Given a sampled run measured a script
      And that package's package.json no longer defines the script
      When the weights are computed
      Then the script is dropped, so the written file names only scripts the gate runs

    @unit
    Scenario: A package's weight is the median of its runs, kept per script
      Given a package whose unit and integration scripts were measured in three runs
      When the weights are computed
      Then each script has its own weight, the median of its runs
      And the scheduler weighs the package as the sum of the scripts a leg keeps

  Rule: only complete, green runs are measured

    @unit
    Scenario: A run with a failed shard is skipped
      Given a main run where one package-suites shard failed
      When runs are collected
      Then that run is not measured and the next green one is

    @unit
    Scenario: The browser job is measured when present and must be green
      Given a main run whose shards are green
      When the package-suites browser job is also green
      Then its log is measured with the shards
      And when the browser job failed the run is skipped

    @unit
    Scenario: Too few green runs is an error rather than a thin file
      Given fewer green main runs than were asked for
      When runs are collected
      Then the command fails without writing the file

    @unit
    Scenario: Asking for no runs is an error rather than an empty file
      Given the command is asked to take the median over zero runs
      When runs are collected
      Then the command fails without writing the file

    @unit
    Scenario: GitHub's listings are read strictly
      Given gh lists runs and jobs one per line
      When a line is not the shape asked for
      Then the command fails rather than skipping it

  Rule: the file says where its numbers came from

    @unit
    Scenario: The file lists each script with its own seconds
      Given a weights file with lines "<package>  <script>  <seconds>"
      When it is read
      Then each line is the weight of that script of that package
      And a line of any other shape is skipped

    @unit
    Scenario: The file is written heaviest first and names its runs
      Given weights for several package scripts
      When the file is rendered
      Then the scripts are listed heaviest first, ties by package then script
      And scripts under the listing threshold are left to the default
      And the header names the runs the numbers came from

  Rule: a weight counts only while the gate still runs that script

    @unit
    Scenario: Workspace globs decide which packages define scripts
      Given a workspace whose globs match packages at several depths
      When the defined scripts are read
      Then every matched package's scripts are defined
      And a package under a negated glob defines nothing

    @unit
    Scenario: Only the scripts the gate runs are defined
      Given a package with test, test:unit, test:integration, test:browser and build
      When its defined scripts are chosen
      Then test:unit wins over test, and integration and browser are kept
      And build is not defined
