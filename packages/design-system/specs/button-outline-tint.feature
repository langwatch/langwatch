Feature: An outline button takes the hue it is given
  As someone building a screen
  I want an outline button with a colour palette to draw in that colour
  So that a tinted secondary action, like contacting sales, reads apart from neutral ones

  @integration
  Scenario: An outline button with a hue draws its border and label in that hue
    Given an outline button with the orange colour palette
    Then its border is the palette's solid colour
    And its label is the palette's foreground colour

  @integration
  Scenario: An outline button without a hue stays neutral
    Given an outline button with no colour palette, and one with the gray palette
    Then both draw the neutral border and the default foreground colour
