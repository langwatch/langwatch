Feature: Negate filters and trace scoping affect analytics results
  As a platform user
  I want the Negate Filters toggle and trace-scoped graphs to affect the data
  So that the charts show what the controls say they show

  The analytics toolbar offers a Negate Filters toggle (show everything EXCEPT
  the selected filters) and some graphs are scoped to an explicit set of
  traces. Both must reach the executed query: a negated query that silently
  returns non-negated results, or a trace-scoped graph that silently covers
  all traces, misleads the user without any visible error.

  Background:
    Given a project with analytics data

  @unit
  Scenario: Negating filters inverts the data selection
    Given a timeseries request with filters and the negate toggle enabled
    When the query is executed
    Then the executed query carries the negation

  @unit
  Scenario: A graph scoped to specific traces reads only those traces
    Given a timeseries request scoped to specific trace ids
    When the query is executed
    Then the executed query carries the trace scope

  @unit
  Scenario: Negated filters stay accurate on optimized analytics storage
    Given a project with the optimized analytics read path enabled
    And a timeseries request the optimized storage could otherwise serve
    When the request carries the negate toggle
    Then the query is served by the storage that honors the negation

  # A caller can leave trace origins out of a count on its own account, apart
  # from the user's filters: the home figures leave out Langy's own turns,
  # which trace into the project (ADR-061) but were never sent by the
  # customer. The exclusion is not part of the selection the toggle negates.
  @unit
  Scenario: Leaving out an origin keeps the rest of the count intact
    Given a timeseries request that leaves out the "langy" origin
    When the query is executed
    Then the executed query keeps every trace of every other origin
    And the exclusion is not inverted when the negate toggle is enabled

  @unit
  Scenario: Leaving out an origin stays accurate on optimized analytics storage
    Given a project with the optimized analytics read path enabled
    And a timeseries request the bucketed storage could otherwise serve
    When the request leaves out an origin
    Then the query is served by the storage that keeps the origin of every trace

  @unit
  Scenario: Trace-scoped graphs stay accurate on optimized analytics storage
    Given a project with the optimized analytics read path enabled
    And a timeseries request the optimized storage could otherwise serve
    When the request is scoped to specific trace ids
    Then the query is served by the storage that honors the trace scope
