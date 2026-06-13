Feature: Dark Mode Toggle

  Background:
    Given the user is logged into LangWatch

  Scenario: Toggle dark mode from the header
    When the user clicks the color mode button in the top navigation
    Then the UI switches to dark mode
    And the background becomes dark
    And text remains readable

  Scenario: Toggle back to light mode
    Given the user is in dark mode
    When the user clicks the color mode button in the top navigation
    Then the UI switches to light mode

  Scenario: Dark mode preference persists across page navigation
    Given the user has enabled dark mode
    When the user navigates to a different page
    Then the UI remains in dark mode

  Scenario: System preference is respected by default
    Given the user has not set a preference
    Then the UI follows the operating system color scheme preference
