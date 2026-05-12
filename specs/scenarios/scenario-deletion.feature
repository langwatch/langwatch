Feature: Scenario Archiving
  As a LangWatch user
  I want to archive scenarios from the library
  So that I can remove test cases I no longer need while preserving history

  Background:
    Given I am logged into project "my-project"
    And the following scenarios exist:
      | name                         | labels       |
      | Cross-doc synthesis question | doc-qa       |
      | SaaS documentation guidance  | saas         |
      | Failed booking escalation    | booking      |
      | Angry double-charge refund   | billing      |
      | HTTP troubleshooting request | http         |

  # ============================================================================
  # E2E: Happy Paths — Full User Workflows
  # ============================================================================

  @e2e @unimplemented
  Scenario: Archive a single scenario via row action menu
    When I am on the scenarios list page
    And I open the row action menu for "Angry double-charge refund"
    And I click "Archive"
    Then I see a confirmation modal asking to archive "Angry double-charge refund"
    When I confirm the archive
    Then "Angry double-charge refund" no longer appears in the scenarios list
    And the remaining 4 scenarios are still visible

  @e2e @unimplemented
  Scenario: Batch archive multiple selected scenarios
    When I am on the scenarios list page
    And I select the checkbox for "Cross-doc synthesis question"
    And I select the checkbox for "Failed booking escalation"
    Then I see a batch action bar showing "2 selected"
    When I click the "Archive" button in the batch action bar
    Then I see a confirmation modal listing both scenarios
    When I confirm the archive
    Then neither scenario appears in the scenarios list
    And the remaining 3 scenarios are still visible

  # ============================================================================
  # Integration: Row Selection UI
  # ============================================================================

  # ============================================================================
  # Integration: Single Archive via Row Action Menu
  # ============================================================================

  # ============================================================================
  # Integration: Batch Archive
  # ============================================================================

  # ============================================================================
  # Integration: Soft Archive Backend Behavior
  # ============================================================================

  # ============================================================================
  # Integration: Archived Scenario Guardrails
  # ============================================================================

  # ============================================================================
  # Integration: Negative Paths
  # ============================================================================

  # ============================================================================
  # Unit: Selection State Logic
  # ============================================================================

