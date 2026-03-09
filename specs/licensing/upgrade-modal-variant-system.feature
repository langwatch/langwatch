Feature: Upgrade Modal Variant System
  As a LangWatch platform developer
  I want the upgrade modal to support multiple content variants via a data-driven map
  So that new modal modes can be added without growing conditional chains

  Background:
    Given the upgrade modal is rendered globally via DashboardLayout

  # ============================================================================
  # Store: Existing Variants Unchanged
  # ============================================================================

  @unit
  Scenario: open() sets limit variant with legacy fields
    When I call open("workflows", 5, 10)
    Then the store state is:
      | field     | value       |
      | isOpen    | true        |
      | mode      | limit       |
      | limitType | workflows   |
      | current   | 5           |
      | max       | 10          |

  @unit
  Scenario: openSeats() sets seats variant and clears legacy fields
    When I call openSeats with organizationId "org-1", currentSeats 3, newSeats 5
    Then the store state is:
      | field          | value  |
      | isOpen         | true   |
      | mode           | seats  |
      | organizationId | org-1  |
      | currentSeats   | 3      |
      | newSeats       | 5      |
    And the legacy fields limitType, current, max are null

  @unit
  Scenario: close() resets all state
    Given the modal is open in any variant mode
    When I call close()
    Then the store state is:
      | field   | value |
      | isOpen  | false |
      | variant | null  |
    And the legacy fields limitType, current, max are null

  # ============================================================================
  # Store: New Lite Member Restriction Variant
  # ============================================================================

  @unit
  Scenario: openLiteMemberRestriction() sets restriction variant
    When I call openLiteMemberRestriction with resource "prompts"
    Then the store state is:
      | field    | value                  |
      | isOpen   | true                   |
      | mode     | liteMemberRestriction  |
      | resource | prompts                |
    And the legacy fields limitType, current, max are null

  @unit
  Scenario: openLiteMemberRestriction() works without resource
    When I call openLiteMemberRestriction without resource
    Then the store state is:
      | field    | value                  |
      | isOpen   | true                   |
      | mode     | liteMemberRestriction  |
      | resource | undefined              |

  @unit
  Scenario: close() resets lite member restriction state
    Given the modal is open in liteMemberRestriction mode
    When I call close()
    Then the store state is:
      | field   | value |
      | isOpen  | false |
      | variant | null  |

  # ============================================================================
  # Variant Map Exhaustiveness
  # ============================================================================

  @unit
  Scenario: every variant mode has a corresponding content component
    Given the UpgradeModalVariant union has modes "limit", "seats", "liteMemberRestriction"
    Then the MODAL_CONTENT map has an entry for each mode
    And no mode is missing from the map
