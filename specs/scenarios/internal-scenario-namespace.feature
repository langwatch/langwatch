Feature: Internal Scenario Set Namespace Display
  As a LangWatch user
  I want internal scenario set IDs to display as friendly names
  So that I see "On-Platform Scenarios" instead of technical namespace IDs

  Background:
    The on-platform scenario runner uses an internal namespace pattern:
    `__internal__${projectId}__on-platform-scenarios`

    This technical ID should never be displayed to users. Instead,
    the UI should show "On-Platform Scenarios" wherever the set ID appears.

  # ============================================================================
  # Display Name Transformation
  # ============================================================================

  @integration
  Scenario: Simulation layout header shows friendly name for internal sets
    Given I am viewing a simulation run in an on-platform scenario set
    When the page header displays the scenario set
    Then I see "On-Platform Scenarios" instead of the internal namespace ID

  @integration
  Scenario: Simulation layout header shows raw ID for user-created sets
    Given I am viewing a simulation run in set "my-custom-set"
    When the page header displays the scenario set
    Then I see "my-custom-set" as the set identifier

  @integration
  Scenario: Empty state message shows friendly name for internal sets
    Given I am viewing an on-platform scenario set with no runs
    When the empty state message is displayed
    Then I see "On-Platform Scenarios" in the message

  @integration
  Scenario: Empty state message shows raw ID for user-created sets
    Given I am viewing set "production-tests" with no runs
    When the empty state message is displayed
    Then I see "production-tests" in the message

  # ============================================================================
  # Cleanup: Deprecated Constants
  # ============================================================================

  @integration
  Scenario: Legacy PLATFORM_SET_ID constant is removed
    When inspecting scenario.constants.ts
    Then no "PLATFORM_SET_ID" constant with value "local-scenarios" exists

  @integration
  Scenario: All scenario set references use getOnPlatformSetId
    When inspecting scenario-related modules
    Then all internal set ID references use getOnPlatformSetId() from internal-set-id.ts
