@governance @dashboard @teams-list
Feature: All teams: what the team activity panel says about its read
  The page lists every team that reported activity in the last 30 days. Its
  panel says one of three things, and only one: the teams, that the window
  held no activity, or that the read failed. A failed read is never drawn
  as an empty window, because "no activity" is an answer the read never gave.
  Decision: none; state honesty on an existing page.

  Background:
    Given an organization member with the governance view permission
    And the member may read the activity monitor

  @integration
  Scenario: A failed team activity read shows only the failure
    Given the team activity read fails
    When the member opens the all-teams page
    Then the page shows an alert saying the team activity could not be loaded
    And no empty state, no table and no team count is shown
    And pressing Try again on the alert reads the team activity again

  @integration
  Scenario: A failed refresh keeps the teams already shown beside the alert
    Given the team activity was read
    And a later team activity read fails
    When the member looks at the all-teams page
    Then the page shows an alert saying the team activity could not be loaded
    And the teams already read stay listed under it

  @integration
  Scenario: A read still in flight claims neither teams nor an empty window
    Given the team activity read has not answered yet
    When the member opens the all-teams page
    Then the panel shows that it is loading
    And it says nothing about the window and shows no team count

  @integration
  Scenario: A window with no team activity says so
    Given the team activity read answers with no teams
    When the member opens the all-teams page
    Then the panel says there was no team activity this window
