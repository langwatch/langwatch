Feature: MainMenu compact mode avoids hydration warnings
  As a developer
  I need MainMenu's collapsed-sidebar section labels to be valid HTML
  So the React hydration warning "<div> cannot be a descendant of <p>" stays out of the console.

  @unit
  Scenario: MainMenu compact mode hydrates without invalid markup
    Given compact navigation is rendered on the server
    When the browser hydrates the MainMenu
    Then no React hydration error is reported
    And compact section labels remain visually hidden
