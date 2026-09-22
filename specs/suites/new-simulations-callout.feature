Feature: The previous-screens preference keeps the old simulations screens

  A per-project, per-browser preference recorded on this machine keeps the
  previous simulations screens: the main menu offers the Simulations group
  again and the `/simulations` addresses stop redirecting to Agent Testing,
  while the release flag stays on for everyone else on the project.

  Background:
    Given a project that reads Agent Testing through the release flag

  @unit
  Scenario: The previous-screens preference disables the Agent Testing redirect
    Given the previous-screens preference is recorded for the project
    When the person opens a `/simulations` address
    Then the page renders instead of redirecting to Agent Testing

  @unit
  Scenario: The previous-screens preference restores the Simulations menu
    Given the previous-screens preference is recorded for the project
    When the main menu renders with the release flag on
    Then the menu offers the Simulations group instead of Agent Testing
