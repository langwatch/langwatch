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

  @unit
  Scenario: Trace-scoped graphs stay accurate on optimized analytics storage
    Given a project with the optimized analytics read path enabled
    And a timeseries request the optimized storage could otherwise serve
    When the request is scoped to specific trace ids
    Then the query is served by the storage that honors the trace scope
