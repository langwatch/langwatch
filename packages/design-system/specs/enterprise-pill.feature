Feature: An Enterprise pill marks where a feature is gated
  As a reader on a page a feature gates to Enterprise
  I want one pill that says so, carrying the feature's mark
  So that every gated feature reads the same way

  See packages/design-system/docs/feature-branding.md.

  @integration
  Scenario: The pill shows the word Enterprise beside the feature's mark in one colour
    Given the Enterprise pill for Braids
    When it renders
    Then "Enterprise" is on the screen
    And the Braids mark sits beside it in one colour, hidden from assistive technology

  @integration
  Scenario: The pill without a feature is the word alone
    Given the Enterprise pill with no feature
    When it renders
    Then "Enterprise" is on the screen with no mark
