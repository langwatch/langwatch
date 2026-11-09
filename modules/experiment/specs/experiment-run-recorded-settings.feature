Feature: An experiment run shows the agent version and the concurrency it ran with

  An agent target can be pinned to a deploy label such as production instead of
  a fixed version. The label moves when someone deploys another version, so two
  runs pinned to the same label may have run different versions. A run also
  takes its concurrency from the run API request or the workbench setting, else
  the server default. Each run records the version its labels resolved to and
  the concurrency it used when it started, and the results page shows both. Runs recorded before this keep showing what they recorded.

  @unit
  Scenario: A run records the version an agent label resolved to when it started
    Given an agent target pinned to "production", which points at version 3
    When the run's start is built
    Then the run's target records the label "production" and version 3

  @unit
  Scenario: A target running the latest agent records no label
    Given an agent target with no deploy label
    When the run's start is built
    Then the run's target records no label and no agent version

  @unit
  Scenario: A prompt target following the latest records the version it loaded
    Given a prompt target with no pinned version, whose prompt loaded at version 4
    When the run's start is built
    Then the run's target records prompt version 4

  @unit
  Scenario: The run keeps the concurrency its plan carried
    Given a run started with a plan whose concurrency is 1
    When the start is folded into the run's state
    Then the run holds concurrency 1

  @unit
  Scenario: A run started without a plan holds no concurrency
    Given a run started by an SDK that sends no plan
    When the start is folded into the run's state
    Then the run holds no concurrency

  @integration
  Scenario: A stored run reads back its concurrency and its targets' label versions
    Given a run stored with concurrency 2 and a target pinned to "production" at version 3
    When the run and the experiment's run list are read
    Then both carry concurrency 2
    And the target reads label "production" at version 3

  @integration
  Scenario: A run stored before runs recorded concurrency reads none
    Given a run stored with no concurrency
    When the run is read
    Then its concurrency is null

  @integration
  Scenario: A per-run concurrency is answered by the run API and leaves the saved setting alone
    Given an experiment whose saved concurrency is 10
    When a run is started through the run API with concurrency 1
    Then the start answer and the poll answer carry concurrency 1
    And the experiment's saved concurrency is still 10

  @integration
  Scenario: The results page shows the version a label resolved to
    Given a run whose agent target ran "production" at version 3
    When the results page shows that run
    Then the target column header reads "production · v3"
    And the run list entry reads "production · v3"

  @integration
  Scenario: A run recorded before label versions shows the label alone
    Given a run whose agent target recorded "production" but no version
    When the results page shows that run
    Then the target column header reads "production"

  @integration
  Scenario: The run summary shows the concurrency the run used
    Given a run that recorded concurrency 1
    When the results page lists that run
    Then its run list entry reads "Concurrency 1"
    And a run with no recorded concurrency shows no concurrency
