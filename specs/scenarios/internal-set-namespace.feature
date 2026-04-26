Feature: Internal Set ID Namespace
  As a LangWatch user
  I want on-platform scenarios to use a distinct internal namespace
  So that internal sets do not collide with user-created set names

  # ============================================================================
  # Utility Functions - Set ID Detection
  # ============================================================================
  # Pure logic for detecting and generating internal set IDs.
  # Pattern: __internal__${projectId}__on-platform-scenarios

  # ============================================================================
  # Backend - Simulation Runner Uses Internal Namespace
  # ============================================================================
  # When running scenarios on-platform, the set ID is generated from project ID.

  # ============================================================================
  # UI - Set Card Display for Internal Sets
  # ============================================================================
  # Internal sets display a friendly name and visual distinction.

  @integration @unimplemented
  Scenario: Display friendly name for internal set
    Given set card receives set ID "__internal__proj_abc123__on-platform-scenarios"
    When the SetCard renders
    Then it displays "On-Platform Scenarios" as the name
    And it does not display the raw internal ID

  # ============================================================================
  # UI - Set List Sorting
  # ============================================================================
  # Internal sets are pinned to top of the list.

  # ============================================================================
  # E2E - Complete Workflow
  # ============================================================================
  # Full user journey seeing internal set on the simulations page.

  @e2e @unimplemented
  Scenario: View on-platform scenarios in simulations list
    Given I am logged into project "my-project"
    And scenarios have been run on-platform
    When I navigate to "/my-project/simulations"
    Then I see "On-Platform Scenarios" as a set card
    And the card appears at the top of the list
    When I click on the "On-Platform Scenarios" card
    Then I see the runs for that set
