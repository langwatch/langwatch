Feature: Restoring an older test case version
  As a person who made an edit that made a test case worse
  I want to bring back an older version
  So that I can go back without losing the record of what happened

  Background: restore adds, it never rewrites.
    Restoring reads an older version and saves its content as a new version at
    the top of the history. The older version stays where it is. The history is
    append-only, so a restore is itself an entry and can be undone by restoring
    the version before it.

    How versions are made is in specs/scenarios/scenario-versioning.feature.

  # --- Restoring ---

  @integration
  Scenario: Restoring an older version writes a new version at the top
    Given a test case at version 5
    When version 2 is restored
    Then the case reads as version 6
    And its content is the content of version 2
    And version 5 is still in the history, unchanged

  @integration
  Scenario: The restore entry says which version it came from
    Given a test case at version 5
    When version 2 is restored
    Then the newest history entry says it restored version 2
    And it names the person who restored it

  @integration
  Scenario: A restore can be undone by restoring the version before it
    Given a test case at version 6 that restored version 2
    When version 5 is restored
    Then the case reads as version 7
    And its content is the content of version 5

  @integration
  Scenario: Restoring the newest version still writes an entry
    Given a test case at version 5
    When version 5 is restored
    Then the case reads as version 6
    And the content is unchanged

  # --- What is restored ---

  @unit
  Scenario: A restore brings back the editable content and nothing else
    Given a version that holds a name, a situation, criteria, labels and parameters
    When it is restored
    Then all of those are written to the case
    And the folder of the case is not changed
    And the run history of the case is not changed

  # --- Failure paths ---

  @integration
  Scenario: Restoring a version that does not exist is refused with scenario_version_not_found
    Given a test case at version 5
    When version 9 is restored
    Then the request is refused with "scenario_version_not_found"
    And the case is unchanged

  @integration
  Scenario: Restoring a version of a case in another project is refused with not_found
    Given a version of a test case that belongs to another project
    When it is restored
    Then the request is refused with "not_found"

  @integration
  Scenario: A viewer cannot restore a version
    Given a person with read-only access to the project
    When they try to restore a version
    Then the request is refused with "insufficient_permissions"
    And the case is unchanged

  @integration
  Scenario: Restoring an archived scenario is refused
    Given an archived test case
    When one of its versions is restored
    Then the request is refused
    And the case stays archived
