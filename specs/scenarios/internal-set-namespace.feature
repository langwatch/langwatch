Feature: Internal Set ID Namespace
  As a LangWatch user
  I want on-platform scenarios to use a distinct internal namespace
  So that internal sets do not collide with user-created set names

  # ============================================================================
  # Utility Functions - Set ID Detection
  # ============================================================================
  # Pure logic for detecting and generating internal set IDs.
  # Pattern: __internal__${projectId}__on-platform-scenarios

  @unit
  Scenario: Detect internal set ID by prefix
    Given a set ID "__internal__proj_abc123__on-platform-scenarios"
    When isInternalSetId is called
    Then it returns true

  @unit
  Scenario: Reject non-internal set ID
    Given a set ID "my-custom-scenarios"
    When isInternalSetId is called
    Then it returns false

  @unit
  Scenario: Detect on-platform set by suffix
    Given a set ID "__internal__proj_abc123__on-platform-scenarios"
    When isOnPlatformSet is called
    Then it returns true

  @unit
  Scenario: Reject set without on-platform suffix
    Given a set ID "__internal__proj_abc123__custom-scenarios"
    When isOnPlatformSet is called
    Then it returns false

  @unit
  Scenario: Generate on-platform set ID for project
    Given a project ID "proj_abc123"
    When getOnPlatformSetId is called
    Then it returns "__internal__proj_abc123__on-platform-scenarios"

  # ============================================================================
  # Backend - Simulation Runner Uses Internal Namespace
  # ============================================================================
  # When running scenarios on-platform, the set ID is generated from project ID.

  @integration
  Scenario: On-platform scenario run uses internal set ID
    Given project "proj_abc123" exists
    And scenario "Test Scenario" exists in the project
    When the scenario is run on-platform without explicit set ID
    Then the run is associated with set "__internal__proj_abc123__on-platform-scenarios"

  @integration
  Scenario: External SDK run preserves user-provided set ID
    Given project "proj_abc123" exists
    And scenario "Test Scenario" exists in the project
    When the scenario is run via SDK with set ID "production-tests"
    Then the run is associated with set "production-tests"
    And the internal set is not affected

  # ============================================================================
  # UI - Set Card Display for Internal Sets
  # ============================================================================
  # Internal sets display a friendly name and visual distinction.

  @integration
  Scenario: Display friendly name for internal set
    Given set card receives set ID "__internal__proj_abc123__on-platform-scenarios"
    When the SetCard renders
    Then it displays "On-Platform Scenarios" as the name
    And it does not display the raw internal ID

  @integration
  Scenario: Display system icon for internal set
    Given set card receives set ID "__internal__proj_abc123__on-platform-scenarios"
    When the SetCard renders
    Then it displays a system/settings icon instead of the default icon

  @integration
  Scenario: Display user set name for non-internal set
    Given set card receives set ID "my-production-tests"
    When the SetCard renders
    Then it displays "my-production-tests" as the name
    And it displays the default icon

  # ============================================================================
  # UI - Set List Sorting
  # ============================================================================
  # Internal sets are pinned to top of the list.

  @integration
  Scenario: Pin internal set to top of list
    Given the following sets exist:
      | setId                                           | lastRunAt           |
      | my-production-tests                             | 2024-01-15T10:00:00 |
      | __internal__proj_abc123__on-platform-scenarios  | 2024-01-10T10:00:00 |
      | nightly-tests                                   | 2024-01-14T10:00:00 |
    When the simulations page renders
    Then the internal set appears first in the list
    And the remaining sets are sorted by last run date

  # ============================================================================
  # E2E - Complete Workflow
  # ============================================================================
  # Full user journey seeing internal set on the simulations page.

  @e2e
  Scenario: View on-platform scenarios in simulations list
    Given I am logged into project "my-project"
    And scenarios have been run on-platform
    When I navigate to "/my-project/simulations"
    Then I see "On-Platform Scenarios" as a set card
    And the card appears at the top of the list
    When I click on the "On-Platform Scenarios" card
    Then I see the runs for that set
