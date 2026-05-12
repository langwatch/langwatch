Feature: Impersonation banner in dashboard

  When an admin impersonates another user, the dashboard header should
  display a prominent blue banner so the admin never forgets they are
  acting as someone else. The banner provides a quick way to stop
  impersonating without opening the user menu.

  Background:
    Given an admin user is logged in

  Scenario: Blue impersonation banner appears in the header
    Given the admin is impersonating another user
    When the dashboard loads
    Then a blue gradient banner is visible in the header bar
    And the banner text reads "Impersonating <user name or email>"
    And the banner includes a "Stop" button

  Scenario: Impersonation banner does not appear for normal sessions
    When the dashboard loads
    Then no impersonation banner is visible

  Scenario: Clicking stop ends impersonation
    Given the admin is impersonating another user
    When the admin clicks the "Stop" button on the impersonation banner
    Then a DELETE request is sent to the impersonation endpoint
    And the page redirects to the admin panel

  Scenario: Banner coexists with dev mode indicator
    Given the admin is impersonating another user
    And the environment is development mode
    When the dashboard loads
    Then the blue impersonation glow replaces the orange dev mode glow
    And the impersonation banner is visible alongside the DEV badge
