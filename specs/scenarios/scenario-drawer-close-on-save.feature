Feature: Scenario drawer closes after saving completes
  As a LangWatch user
  I want the scenario drawer to close automatically after a successful save
  So that I return to the scenario list without an extra manual step

  Background:
    Given I am logged into project "my-project"

  # Per AUDIT_MANIFEST.md: 4 scenarios → 3 DUPLICATE (now bound via @scenario
  # JSDoc against ScenarioFormDrawer.integration.test.tsx) + 1 UPDATE.
  # The UPDATE scenario remains @unimplemented because its premise contradicts
  # current implementation (save-and-run actually CLOSES the drawer); rewrite
  # tracked in PR #3458.

  @integration @unimplemented
  Scenario: Drawer stays open after save-and-run
    Given I am editing scenario "Refund Flow" in the drawer
    And a target is selected
    When I click "Save and Run"
    Then the scenario drawer remains open
