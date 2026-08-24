Feature: A run records the test case version it used
  As a person who reads a run from last month
  I want to know which version of the test case produced it
  So that I can tell a real change in the agent from a change in the test

  Background: when the version is recorded.
    The version of a test case is written onto the run when the run is queued,
    not when it finishes. A later edit of the case never changes what an old
    run says.

    The version is recorded the same way for a run started from a test suite,
    from a custom run plan, and for a one-off run of a single case.

    How versions are made is in specs/scenarios/scenario-versioning.feature.

  # --- Stamping ---

  @integration
  Scenario: A test suite run records the version of every case it ran
    Given a test suite holding two cases, at version 3 and at version 7
    When the suite is run
    Then the run of the first case records version 3
    And the run of the second case records version 7

  @integration
  Scenario: A one-off run of a single case records that case version
    Given a test case at version 5
    When Run is chosen on its row and a target is confirmed
    Then the run records version 5

  @integration
  Scenario: Editing a case after a run leaves the run unchanged
    Given a finished run of a test case at version 5
    When the case is edited and saved, so it reads as version 6
    Then the finished run still records version 5

  @unit
  Scenario: The version stamped is the version read when the batch was queued
    Given a run plan whose cases are read once at queue time
    When the batch is queued
    Then each queued run carries the version read in that same read

  # --- Reading it back ---

  @integration
  Scenario: The run detail drawer shows the version the run used
    Given a finished run that records version 5
    When its detail drawer is opened
    Then the drawer shows the test case name with version 5 beside it

  @integration
  Scenario: The version in the drawer opens the history of that case
    Given a run detail drawer that shows a version
    When the version is chosen
    Then the history drawer for that test case opens
    And the version the run used is marked in the list

  @integration
  Scenario: A run made before versions were recorded shows no version
    Given a finished run stored before versions were recorded
    When its detail drawer is opened
    Then no version is shown
    And nothing else in the drawer changes

  # --- The target reference on the same record ---

  @unit
  Scenario: A one-off run records which target it ran against
    Given a one-off run against an HTTP agent
    When the run is queued
    Then the run records the target it ran against and the kind of that target

  @unit
  Scenario: A suite run records the kind of target as well as the target
    Given a suite run against a prompt target
    When the run is queued
    Then the run records the target it ran against and the kind of that target
