Feature: Internal Scenario Set Namespace Display
  As a LangWatch user
  I want internal scenario set IDs to display as friendly names
  So that I see "On-Platform Scenarios" instead of technical namespace IDs

  # Per AUDIT_MANIFEST.md: 6 scenarios → 2 DUPLICATE (already covered elsewhere
  # and removed) + 2 UPDATE (display name change, both have it.skip in component
  # tests) + 2 DELETE (legacy PLATFORM_SET_ID + getOnPlatformSetId migration —
  # already complete). The 2 UPDATE scenarios remain @unimplemented pending the
  # ON_PLATFORM_DISPLAY_NAME source change in PR #3458.

  Background:
    The on-platform scenario runner uses an internal namespace pattern:
    `__internal__${projectId}__on-platform-scenarios`

    This technical ID should never be displayed to users. Instead,
    the UI should show "On-Platform Scenarios" wherever the set ID appears.

  # ============================================================================
  # Display Name Transformation
  # ============================================================================

  @integration @unimplemented
  Scenario: Simulation layout header shows friendly name for internal sets
    Given I am viewing a simulation run in an on-platform scenario set
    When the page header displays the scenario set
    Then I see "On-Platform Scenarios" instead of the internal namespace ID

  @integration @unimplemented
  Scenario: Empty state message shows friendly name for internal sets
    Given I am viewing an on-platform scenario set with no runs
    When the empty state message is displayed
    Then I see "On-Platform Scenarios" in the message

  # ============================================================================
  # Cleanup: Deprecated Constants
  # ============================================================================

