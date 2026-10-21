Feature: A branded feature's lockup sets its mark beside its name
  As a reader landing on a branded feature's page
  I want the feature's name set beside its mark in the display face
  So that the feature reads as a named part of LangWatch

  See packages/design-system/docs/feature-branding.md.

  @integration
  Scenario: The lockup shows the mark and the feature's name in the display face
    Given the Braids lockup
    When it renders
    Then the word "Braids" is on the screen in the display face
    And the Braids mark sits beside it, hidden from assistive technology

  @integration
  Scenario: The lockup shows the launch tagline when asked
    Given the Braids lockup with its tagline
    When it renders
    Then "One trace. Every project." is on the screen under the name

  @integration
  Scenario: The small lockup draws the mark's small master
    Given the Braids lockup at its small size
    When it renders
    Then its mark draws the small master
