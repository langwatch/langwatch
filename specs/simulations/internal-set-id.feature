@unit
Feature: Internal Set ID for On-Platform Scenarios
  As a LangWatch platform engineer
  I want to use a standardized internal set ID pattern for on-platform scenarios
  So that internal sets are clearly distinguished from user-created sets and can be displayed appropriately

  # ============================================================================
  # Internal Set ID Pattern (Backend)
  # ============================================================================

  Scenario: Generate on-platform set ID with project context
    Given a project with ID "proj_abc123"
    When scenarios are run on-platform
    Then the set ID uses pattern "__internal__proj_abc123__on-platform-scenarios"

  Scenario: On-platform set ID is no longer hardcoded as "local-scenarios"
    Given a project with ID "proj_xyz789"
    When scenarios are run on-platform
    Then the set ID is NOT "local-scenarios"
    And the set ID contains the project ID "proj_xyz789"

  Scenario: Each project has its own internal set ID
    Given project "proj_A" runs on-platform scenarios
    And project "proj_B" runs on-platform scenarios
    Then project "proj_A" set ID is "__internal__proj_A__on-platform-scenarios"
    And project "proj_B" set ID is "__internal__proj_B__on-platform-scenarios"

  # ============================================================================
  # Utility Functions - isInternalSetId
  # ============================================================================

  Scenario: isInternalSetId detects internal sets by prefix
    When I call isInternalSetId with "__internal__proj_123__on-platform-scenarios"
    Then it returns true

  Scenario: isInternalSetId returns false for user-created sets
    When I call isInternalSetId with "my-custom-scenario-set"
    Then it returns false

  Scenario: isInternalSetId returns false for legacy local-scenarios
    When I call isInternalSetId with "local-scenarios"
    Then it returns false

  Scenario: isInternalSetId handles edge cases
    When I call isInternalSetId with ""
    Then it returns false
    When I call isInternalSetId with "__internal__"
    Then it returns true
    When I call isInternalSetId with "__internal"
    Then it returns false

  # ============================================================================
  # Utility Functions - isOnPlatformSet
  # ============================================================================

  Scenario: isOnPlatformSet detects on-platform sets by suffix
    When I call isOnPlatformSet with "__internal__proj_123__on-platform-scenarios"
    Then it returns true

  Scenario: isOnPlatformSet returns false for other internal sets
    When I call isOnPlatformSet with "__internal__proj_123__other-type"
    Then it returns false

  Scenario: isOnPlatformSet returns false for user-created sets
    When I call isOnPlatformSet with "user-scenarios-set"
    Then it returns false

  Scenario: isOnPlatformSet handles suffix-only matching
    When I call isOnPlatformSet with "on-platform-scenarios"
    Then it returns false
    When I call isOnPlatformSet with "__internal__proj_xyz__on-platform-scenarios"
    Then it returns true

  # ============================================================================
  # Utility Functions - getOnPlatformSetId
  # ============================================================================

  Scenario: getOnPlatformSetId generates correct set ID
    When I call getOnPlatformSetId with projectId "proj_abc123"
    Then it returns "__internal__proj_abc123__on-platform-scenarios"

  Scenario: getOnPlatformSetId handles various project ID formats
    When I call getOnPlatformSetId with projectId "my-project"
    Then it returns "__internal__my-project__on-platform-scenarios"
    When I call getOnPlatformSetId with projectId "project_with_underscores"
    Then it returns "__internal__project_with_underscores__on-platform-scenarios"

  # ============================================================================
  # Utility Functions - getDisplayName
  # ============================================================================

  Scenario: getDisplayName returns friendly name for internal on-platform sets
    When I call getDisplayName with "__internal__proj_123__on-platform-scenarios"
    Then it returns "On-Platform Scenarios"

  Scenario: getDisplayName returns original name for user-created sets
    When I call getDisplayName with "my-custom-set"
    Then it returns "my-custom-set"

  Scenario: getDisplayName returns original name for non on-platform internal sets
    When I call getDisplayName with "__internal__proj_123__other-type"
    Then it returns "__internal__proj_123__other-type"

  # ============================================================================
  # UI Treatment - Icon Display
  # ============================================================================

  @visual
  Scenario: Internal sets display system icon
    Given I am viewing the simulation sets list
    And there is an internal set "__internal__proj_123__on-platform-scenarios"
    Then the internal set displays a settings gear icon
    And the internal set does NOT display the theater masks icon

  @visual
  Scenario: User-created sets display default icon
    Given I am viewing the simulation sets list
    And there is a user-created set "my-custom-scenarios"
    Then the user-created set displays the theater masks icon
    And the user-created set does NOT display the settings gear icon

  # ============================================================================
  # UI Treatment - Display Name
  # ============================================================================

  @visual
  Scenario: Internal sets show friendly display name
    Given I am viewing the simulation sets list
    And there is an internal set "__internal__proj_abc__on-platform-scenarios"
    Then the set displays as "On-Platform Scenarios"
    And the set does NOT display the raw internal ID

  @visual
  Scenario: User-created sets show their actual name
    Given I am viewing the simulation sets list
    And there is a user-created set "Customer Support Tests"
    Then the set displays as "Customer Support Tests"

  # ============================================================================
  # UI Treatment - List Ordering
  # ============================================================================

  @visual
  Scenario: Internal sets are pinned to top of list
    Given I am viewing the simulation sets list
    And there are sets:
      | setId                                           | type     |
      | __internal__proj_123__on-platform-scenarios     | internal |
      | alpha-scenarios                                 | user     |
      | beta-scenarios                                  | user     |
    Then the sets are displayed in order:
      | position | displayName           |
      | 1        | On-Platform Scenarios |
      | 2        | alpha-scenarios       |
      | 3        | beta-scenarios        |

  @visual
  Scenario: User-created sets maintain alphabetical order below internal sets
    Given I am viewing the simulation sets list
    And there are sets:
      | setId                                           | type     |
      | __internal__proj_123__on-platform-scenarios     | internal |
      | zebra-scenarios                                 | user     |
      | apple-scenarios                                 | user     |
    Then "On-Platform Scenarios" appears first
    And "apple-scenarios" appears before "zebra-scenarios"

  @visual
  Scenario: Multiple internal sets are grouped at top
    Given I am viewing the simulation sets list
    And there are multiple internal sets and user sets
    Then all internal sets appear before any user sets
    And user sets maintain their original ordering
