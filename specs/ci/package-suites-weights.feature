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
    Scenario: A package's weight is the median of its runs, summed over its scripts
      Given a package whose unit and integration scripts were measured in three runs
      When the weights are computed
      Then its weight is the median of each script plus the median of the other

  Rule: only complete, green runs are measured

    @unit
    Scenario: A run with a failed shard is skipped
      Given a main run where one package-suites shard failed
      When runs are collected
      Then that run is not measured and the next green one is

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

  Rule: the file says where its numbers came from

    @unit
    Scenario: The file is written heaviest first and names its runs
      Given weights for several packages
      When the file is rendered
      Then the packages are listed heaviest first, ties by name
      And packages under the listing threshold are left to the default
      And the header names the runs the numbers came from
