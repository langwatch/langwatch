Feature: Scenario Bulk Actions
  As a LangWatch user
  I want a floating action bar when I select multiple scenarios
  So that I can perform bulk operations efficiently

  Background:
    Given I am logged into project "my-project"
    And scenarios exist in the project:
      | name            | labels      |
      | Refund Flow     | ["support"] |
      | Billing Check   | ["billing"] |
      | Greeting Prompt | ["general"] |

  # Per AUDIT_MANIFEST.md: 5 scenarios → 3 DUPLICATE (now bound via @scenario
  # JSDoc against ScenarioTable.integration.test.tsx BatchActionBar tests) +
  # 2 KEEP-E2E (scroll-stickiness + end-to-end archive flow) which remain
  # @unimplemented pending E2E coverage in PR #3458.

  @e2e @unimplemented
  Scenario: Floating bar stays fixed during scroll
    Given I am on the scenarios list page
    And the scenario list is long enough to scroll
    When I select "Refund Flow"
    And I scroll down the scenario list
    Then the floating action bar remains visible

  @e2e @unimplemented
  Scenario: Archive selected scenarios via floating bar
    Given I am on the scenarios list page
    And I select "Refund Flow" and "Billing Check"
    When I click "Archive" on the floating action bar
    And I confirm the archive
    Then "Refund Flow" and "Billing Check" are no longer in the list
    And the floating action bar disappears
