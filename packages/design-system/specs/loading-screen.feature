Feature: The loading screen shows the LangWatch logo at once
  As a reader waiting for a page
  I want the LangWatch logo on screen from the first frame
  So that the wait reads as the product starting, not as a blank page

  @integration
  Scenario: The logo is on the first frame of the loading screen
    Given the loading screen has never been shown before
    When the loading screen renders
    Then the LangWatch logo is on the screen at full strength
    And nothing above it starts faded out

  @integration
  Scenario: The loading screen stands still for a reader who asked for less motion
    Given the reader has asked their system for less motion
    When the loading screen renders
    Then the LangWatch logo is on the screen
    And the moving background is never started
