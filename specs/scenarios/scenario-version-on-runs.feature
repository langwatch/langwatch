Feature: A run records the scenario version it used
  As a person who reads a run from last month
  I want to know which version of the scenario produced it
  So that I can tell a real change in the agent from a change in the test

  Background: when the version is recorded.
    The version of a scenario is written onto the run when the run is queued,
    not when it finishes. A later edit of the scenario never changes what an old
    run says.

    The version is recorded the same way for a run started from a test suite,
    from a run plan, and for a run of a single scenario.

    How versions are made is in specs/scenarios/scenario-versioning.feature.

  # --- Stamping ---

  @integration
  Scenario: A test suite run records the version of every scenario it ran
    Given a test suite holding two scenarios, at version 3 and at version 7
    When the suite is run
    Then the run of the first scenario records version 3
    And the run of the second scenario records version 7

  @integration
  Scenario: A single-scenario run records that scenario version
    Given a scenario at version 5
    When a run of that scenario is started against a target
    Then the run records version 5

  @integration
  Scenario: Editing a scenario after a run leaves the run unchanged
    Given a finished run of a scenario at version 5
    When the scenario is edited and saved, so it reads as version 6
    Then the finished run still records version 5

  @unit
  Scenario: The version stamped is the version read when the batch was queued
    Given a run plan whose scenarios are read once at queue time
    When the batch is queued
    Then each queued run carries the version read in that same read

  # --- Reading it back ---

  @integration
  Scenario: The run detail drawer shows the version the run used
    Given a finished run that records version 5
    When its detail drawer is opened
    Then the drawer shows the scenario name with version 5 beside it

  @integration
  Scenario: The version in the drawer is a fact of the run, not a control
    Given a run detail drawer that shows a version
    When the version is chosen
    Then nothing opens
    And the history stays where it belongs, in the editor of the scenario

  @integration
  Scenario: A run made before versions were recorded shows no version
    Given a finished run stored before versions were recorded
    When its detail drawer is opened
    Then no version is shown
    And nothing else in the drawer changes

  # --- The target reference on the same record ---

  @unit
  Scenario: A single-scenario run records which target it ran against
    Given a single-scenario run against an HTTP agent
    When the run is queued
    Then the run records the target it ran against and the kind of that target

  @unit
  Scenario: A suite run records the kind of target as well as the target
    Given a suite run against a prompt target
    When the run is queued
    Then the run records the target it ran against and the kind of that target
