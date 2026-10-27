Feature: Dashboard refresh after a Langy turn
  Langy creates and edits dashboard widgets through the CLI. An open
  dashboard must show those changes without a manual reload.

  @unit
  Scenario: An open dashboard refetches its widgets when Langy's turn settles
    Given a dashboard page is open with the Langy panel mid-turn
    When the turn settles
    Then the dashboard grid's widget list is invalidated
    And the widgets list query is invalidated

  @unit
  Scenario: A failed turn still refetches the dashboard when it settles
    Given a dashboard page is open with the Langy panel mid-turn
    When the turn fails
    Then the dashboard grid's widget list is invalidated
    And the widgets list query is invalidated

  @unit
  Scenario: A settled turn does not refetch again on later renders
    Given a Langy turn has already settled
    When the panel re-renders with the same status
    Then no query is invalidated again
