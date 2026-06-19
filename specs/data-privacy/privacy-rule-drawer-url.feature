Feature: Shareable privacy rule drawer
  As an admin reviewing a privacy rule
  I want the edit drawer to live in the page URL
  So that I can share a link that opens the exact rule, and the browser back
  button closes the drawer

  # Like every other drawer in the app (see dev/docs/best_practices/drawers.md),
  # the privacy rule drawer is URL-routed: opening it adds a drawer.open
  # parameter plus the scope it targets, and closing it removes them. A pasted
  # link reopens the same rule because the drawer reconstructs itself from the
  # URL, fetching the policy snapshot rather than relying on in-memory state.

  Background:
    Given an organization "acme" with a team "platform" and a project "web-app"

  @integration
  Scenario: Opening a rule to edit reflects in the URL
    Given an organization rule exists on "acme"
    When an admin clicks edit on the organization rule
    Then the URL carries the privacy rule drawer open for the organization scope

  @integration
  Scenario: Opening the add flow reflects in the URL
    When an admin clicks "Add privacy rule"
    Then the URL carries the privacy rule drawer open in add mode

  @integration
  Scenario: A shared link reopens the same rule
    Given a team rule exists on "platform"
    When someone opens a link carrying the privacy rule drawer for the "platform" team scope
    Then the drawer opens showing the team rule

  @integration
  Scenario: Closing the drawer clears it from the URL
    Given the privacy rule drawer is open for the organization scope
    When the admin closes the drawer
    Then the drawer parameters are removed from the URL

  @integration
  Scenario: The browser back button closes the drawer
    Given an admin opened the privacy rule drawer from the data privacy page
    When the admin presses the browser back button
    Then the drawer closes and the data privacy page remains
