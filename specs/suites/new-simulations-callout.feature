Feature: The new-simulations callout offers the way back

  The Agent Testing sidebars pin a small announcement card at the bottom.
  It welcomes the reader to the new simulations screens and offers a click
  back to the previous ones. The click records a per-browser, per-project
  preference: the main menu offers the Simulations group again and the
  `/simulations` addresses stop redirecting to Agent Testing, while the
  release flag stays on for everyone else on the project.

  The card has its own dismissal key, so a person who dismissed the earlier
  voice announcement still sees this one.

  Background:
    Given a project that reads Agent Testing through the release flag

  @unit
  Scenario: The callout shows even after the voice announcement was dismissed
    Given the person dismissed the voice agents announcement in the past
    When the Agent Testing sidebar renders
    Then the new-simulations callout is visible
    And it shows the title "Welcome to the new simulations screen"

  @unit
  Scenario: The sidebar callout leads back to the scenario library
    Given the new-simulations callout is visible in the suites sidebar
    When the person clicks the callout body
    Then the link points at the previous scenario library address
    And the previous-screens preference is recorded for this project

  @unit
  Scenario: The results callout leads back to the runs list
    Given the new-simulations callout is visible in the results runs sidebar
    When the person clicks the callout body
    Then the link points at the previous simulations runs address

  @unit
  Scenario: Dismissing the callout snoozes it without navigating
    Given the new-simulations callout is visible
    When the person clicks the dismiss button
    Then the callout hides at once
    And the previous-screens preference is not recorded
    And the snooze is stored per project with an expiry

  @unit
  Scenario: A person who already went back does not see the offer again
    Given the previous-screens preference is recorded for the project
    When the Agent Testing sidebar renders
    Then the new-simulations callout is not visible

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
