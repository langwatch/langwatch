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

  # Beyond dashboards: every resource Langy writes refreshes the app lists that show it.
  @unit
  Scenario: A scenario Langy creates refreshes the scenario and suite lists
    Given the scenario library or the suites page is open with the Langy panel mid-turn
    When Langy's "langwatch scenario create" call returns its result
    Then the scenarios queries are invalidated
    And the suites queries are invalidated
    And no reload is needed to see the new scenario

  @unit
  Scenario: A suite Langy creates refreshes the suite and scenario lists
    Given the suites page is open with the Langy panel mid-turn
    When Langy's "langwatch test-suite create" call returns its result
    Then the suites queries are invalidated
    And the scenarios queries are invalidated

  @unit
  Scenario: A read does not refresh anything
    Given the Langy panel is mid-turn
    When Langy's "langwatch scenario list" call returns its result
    Then no query is invalidated

  @unit
  Scenario: A write is refreshed once, not on every render
    Given Langy's "langwatch scenario create" call has returned its result
    When the panel re-renders with a new messages list holding the same call
    Then the scenarios queries are not invalidated again

  @unit
  Scenario: A write through a subcommand group refreshes its resource's lists
    Given the Langy panel is mid-turn
    When Langy's "langwatch dataset records add" call returns its result
    Then the dataset record queries are invalidated
    And "teams members add", "groups bindings add" and "prompt tag assign" refresh their resource the same way
    And "dataset records list" refreshes nothing

  @unit
  Scenario: Every write in a chained command refreshes its lists
    Given the Langy panel is mid-turn
    When one shell call runs "langwatch prompt create" and then "langwatch evaluator create"
    Then the prompts queries are invalidated
    And the evaluators queries are invalidated

  @unit
  Scenario: Loading a stored conversation does not refresh its old writes
    Given a stored conversation holds a "langwatch scenario create" call that returned long ago
    When the user opens the conversation in the panel
    Then no query is invalidated
    And a write that returns after the load still refreshes its lists

  @integration
  Scenario: A write a turn in another tab made refreshes this tab's lists
    Given the user has a conversation open in the panel
    And a turn in another tab ran "langwatch evaluator create" in that conversation
    When the panel brings that turn in from the record
    Then the evaluators queries are invalidated
    And the writes the conversation already held are not refreshed again

  @integration
  Scenario: A write a dropped stream never showed refreshes when the record restores it
    Given a Langy turn's stream dropped before its "langwatch evaluator create" call reached the panel
    And the turn went on to complete
    When the panel reloads the turn's answer from the record
    Then the evaluators queries are invalidated

  @unit
  Scenario: Every resource in the capability catalogue is mapped or declared unrefreshed
    Given the capability catalogue lists every CLI resource
    Then each resource names the app query routers it refreshes, or is declared as having none
