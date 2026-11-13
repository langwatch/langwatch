Feature: One Enterprise badge marks where a feature is gated
  As a reader on a page, sidebar entry or setting the Enterprise plan gates
  I want one quiet badge that says so, the same wherever it sits
  So that every gated feature reads the same way

  See packages/design-system/docs/feature-branding.md.

  @integration
  Scenario: The badge reads Enterprise and names the plan when asked
    Given the Enterprise badge
    When it renders
    Then "Enterprise" is on the screen, spelled out, with no mark
    And its title says it is an Enterprise plan feature
