Feature: A board made elsewhere opens from its link
  A board can be made outside the page that lists boards: by Langy, by the CLI or in another
  tab. The board screen reads its board from the list it holds, so a link to a board made after
  that list was read must not show the board as unavailable.

  Background:
    Given I am signed in to a project with Dashboards on

  @integration
  Scenario: Opening a board made after the list was read shows the board
    Given the boards list was read before Langy made the board "Weekly usage"
    When I open the link to "Weekly usage"
    Then the screen waits while the list is read again
    And it shows "Weekly usage", not the unavailable page

  @integration
  Scenario: A board that is really gone is still unavailable after the re-read
    Given the boards list does not hold the board the address names
    And reading the list again does not hold it either
    When I open the link to that board
    Then the screen shows the unavailable page
    And the list is read again only once for that address

  @integration
  Scenario: Coming back to a board still missing reads the list again
    Given I opened a missing board and the list was read again
    And I went on to a board the list holds
    When I come back to the missing board
    Then the list is read again before the screen shows the unavailable page
