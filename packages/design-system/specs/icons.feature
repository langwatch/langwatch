Feature: Icons for repeated interface patterns
  @integration
  Scenario: The row menu trigger draws a decorative ellipsis icon
    Given a row's actions menu trigger that carries a contextual label
    Then it draws a 16px vertical ellipsis from the icons entry point
    And the icon is hidden from assistive technology and takes no focus
    And the trigger is still named by its row, never by the icon
