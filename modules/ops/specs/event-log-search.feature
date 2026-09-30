Feature: Searching the event log from the operator console
  As an operator looking for the aggregate to replay
  I want a search that could scan the whole event log refused up front
  So that an empty box answers as invalid input, never as a server error.

  @unit
  Scenario: An event-log search with no query and no tenant is refused as invalid input
    Given an operator on the event explorer
    When they search with a blank query and no tenant picked
    Then the input schema refuses the search
    And the answer is a client error, not a 500

  @unit
  Scenario: An event-log search bounded by a query or a tenant is accepted
    Given an operator on the event explorer
    When they search with a query, or with a tenant picked and no query
    Then the input schema accepts the search
