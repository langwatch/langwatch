Feature: The new-simulations callout offers the way back

  The Agent Testing sidebars pin a small announcement card at the bottom.
  It welcomes the reader to the new simulations screens and offers a click
  back to the previous ones. The click records a per-browser, per-project
  preference: the main menu offers the Simulations group again and the
  `/simulations` addresses stop redirecting to Agent Testing, while the
  release flag stays on for everyone else on the project.

  The card has its own dismissal key, so a person who dismissed the earlier
  voice announcement still sees this one.

  The card retires on its own three weeks after the new screens shipped. The
  `simulations-welcome=1` address parameter brings it back past the
  retirement, the dismissal and the recorded preference, so the way back to
  the previous screens stays reachable.

  The previous screens carry the way forward: a banner under their header
  shows on the browser that recorded the preference, while the release flag
  is on, and a click clears the preference and the dismissal so the person
  reads the new screens again with the offer intact.

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

  @unit
  Scenario: The callout retires three weeks after the new screens shipped
    Given three weeks passed since the new screens shipped
    When the Agent Testing sidebar renders
    Then the new-simulations callout is not visible

  @unit
  Scenario: The simulations-welcome address parameter brings the callout back
    Given the callout retired, was dismissed, or the preference is recorded
    When the address carries "simulations-welcome=1"
    Then the new-simulations callout is visible

  @unit
  Scenario: The previous screens carry a banner back to the new ones
    Given the previous-screens preference is recorded for the project
    And the release flag is on
    When the scenario library or the simulations page renders
    Then a banner offers the way to the new simulations screen
    And its link points at the matching Agent Testing address

  @unit
  Scenario: The return banner clears the preference on click
    Given the return banner is visible
    When the person clicks it
    Then the previous-screens preference is cleared
    And the welcome callout dismissal is cleared

  @unit
  Scenario: The return banner shows only with the release flag and the preference
    Given the release flag is off, or the preference is not recorded
    When the previous screens render
    Then no return banner is shown
