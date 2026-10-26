Feature: An Enterprise chip marks where a feature is gated
  As a reader on a page or sidebar entry the Enterprise plan gates
  I want one quiet chip that says so, the same wherever it sits
  So that every gated feature reads the same way

  See packages/design-system/docs/feature-branding.md.

  @integration
  Scenario: The chip reads ENT and names the plan when asked
    Given the Enterprise chip
    When it renders
    Then "ENT" is on the screen with no mark
    And its title says it is an Enterprise plan feature
