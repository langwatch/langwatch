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
  Scenario: An event-log search that reaches the explorer with no query and no tenant is a handled client error
    Given a caller that bypassed the input schema
    When the explorer is asked to search with a blank query and no tenant
    Then it refuses with the ops search query required error, a 400, and reads nothing

  @unit
  Scenario: An event-log search bounded by a query or a tenant is accepted
    Given an operator on the event explorer
    When they search with a query, or with a tenant picked and no query
    Then the input schema accepts the search

  # The search reads every tenant, so it runs in the worker and never in the api
  # (ADR-202 Decided 14). The api stores the request and sends its command; the
  # screen reads the result by request id and refetches on the completion hint.

  @unit
  Scenario: An accepted search sends one command under the operator and answers its request id
    Given an operator on the event explorer
    When they search for "trace_abc"
    Then the search is stored pending under a new request id
    And one search command carrying only the request id is sent under the operator's own tenant
    And the answer is the request id, with no event-log read in the api

  @unit
  Scenario: A search with no query and no tenant sends no command
    Given a caller that bypassed the input schema
    When they request a search with a blank query and no tenant
    Then it refuses with the ops search query required error, a 400
    And nothing is stored and no command is sent

  @unit
  Scenario: The worker runs the search and stores the matches under the request id
    Given a pending search for "trace_abc"
    When the worker runs it
    Then the explorer is asked with the query, the tenants and the lower bound the api chose
    And the matching aggregates are stored under the request id, expiring after 10 minutes
    And the search is recorded completed under the operator's tenant

  @unit
  Scenario: The result read is invalidated by the completed search
    Given the result read of an event-log search
    Then its contract names the completed search event as what makes it stale

  @unit
  Scenario: The result answers pending until the worker stores the matches
    Given a search the worker has not run
    When the screen reads its result
    Then the answer is pending

  @unit
  Scenario: An unknown or expired search answers expired
    Given no search under the request id, or one stored more than 10 minutes ago
    When the screen reads its result
    Then the answer is expired, so the operator searches again

  @unit
  Scenario: A search the worker could not run is recorded failed
    Given a pending search
    When the explorer fails on the worker
    Then the search is stored failed, with none of the engine's text
    And the search is still recorded completed, so the screen shows the failure

  @unit
  Scenario: A redelivered search reads the event log once
    Given a search the worker already answered
    When its command is delivered again
    Then the explorer is not asked again
    And the completion is sent with the same idempotency key

  @integration
  Scenario: The explorer says it is searching until the matches arrive
    Given an operator who submitted a search
    When its result is still pending
    Then the explorer shows "Searching…"
