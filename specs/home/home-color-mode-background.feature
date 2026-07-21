@unit
Feature: Home background follows the selected color mode
  As a user reading the project home
  I want a neutral canvas in light mode and the time-of-day atmosphere in dark mode
  So that the page stays clean in daylight without losing the dark theme's depth

  Scenario: Light mode hides the time-of-day aura
    Given the project home is displayed in light mode
    When the home content is rendered
    Then the time-of-day aura is not visible

  Scenario: Dark mode keeps the time-of-day aura
    Given the project home is displayed in dark mode
    When the home content is rendered
    Then the time-of-day aura remains visible
