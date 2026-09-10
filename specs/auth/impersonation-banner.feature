Feature: Impersonation banner in dashboard

  When an admin impersonates another user, the dashboard header shows a
  banner that cannot be missed, so the admin never forgets they are acting as
  someone else. The banner carries the way to stop impersonating, without
  opening the user menu.

  Background:
    Given an admin user is logged in

  @integration
  Scenario: An impersonation banner appears in the header
    Given the admin is impersonating another user
    When the dashboard loads
    Then a banner is visible in the header bar
    And the banner names the person being impersonated
    And the banner offers to stop

  @integration
  Scenario: Impersonation banner does not appear for normal sessions
    When the dashboard loads
    Then no impersonation banner is visible

  @integration
  Scenario: Clicking stop ends impersonation
    Given the admin is impersonating another user
    When the admin chooses to stop on the impersonation banner
    Then the impersonation is ended
    And the admin is taken back to the admin panel

  # A development build marks its header so nobody mistakes it for production.
  # Impersonating on one must not hide either mark: the admin is acting as
  # somebody else AND on a development build, and both facts stay on screen.
  @integration
  Scenario: Banner coexists with dev mode indicator
    Given the admin is impersonating another user
    And the environment is development mode
    When the dashboard loads
    Then the impersonation banner is visible alongside the development badge
