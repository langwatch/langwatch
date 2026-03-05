@unit
Feature: Rename OrganizationUserRole.EXTERNAL to LITE_MEMBER
  As a LangWatch developer
  I want the enum value to match the product terminology
  So that the codebase uses consistent naming for lite members

  # This is a mechanical rename with zero logic changes.
  # The feature file serves as a checklist, not a behavioral spec.

  # ============================================================================
  # Database migration
  # ============================================================================

  Scenario: Migration renames the enum value in-place
    Given the database has OrganizationUserRole enum
    When the migration runs
    Then the enum value "EXTERNAL" is renamed to "LITE_MEMBER"
    And no data rewrite or table scan occurs
    And the 0_init migration is NOT modified

  # ============================================================================
  # Code consistency
  # ============================================================================

  Scenario: No references to EXTERNAL remain in OrganizationUserRole contexts
    Given the codebase uses OrganizationUserRole
    When all references are updated
    Then no file contains OrganizationUserRole.EXTERNAL
    And no Zod schema contains "EXTERNAL" for org role
    And no test asserts against OrganizationUserRole.EXTERNAL

  Scenario: Unrelated EXTERNAL references are not renamed
    Given the codebase has "External Sets" in the suites feature
    When the rename is applied
    Then ExternalSetDetailPanel is unchanged
    And ExternalSetsSidebar is unchanged
    And useSuiteRouting external set logic is unchanged

  # ============================================================================
  # Deploy safety — transition period
  # ============================================================================

  Scenario: Zod schemas accept both values during transition
    Given the migration renames EXTERNAL to LITE_MEMBER
    When rolling deploy has mixed old/new pods
    Then Zod validators accept both "EXTERNAL" and "LITE_MEMBER"
    And a follow-up PR removes "EXTERNAL" from Zod schemas after full deploy

  # ============================================================================
  # Behavior preservation
  # ============================================================================

  Scenario: All existing tests pass with updated references
    When unit tests run
    Then all RBAC tests pass
    And all member classification tests pass
    And all invite service tests pass
    And all organization router tests pass

  Scenario: UI labels remain unchanged
    Given the UI already displays "Lite Member" for lite member users
    When the rename is applied
    Then no UI label text changes
