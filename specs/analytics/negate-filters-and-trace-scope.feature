Feature: Negate filters and trace scoping reach the analytics query
  As a platform user
  I want the Negate Filters toggle and trace-scoped graphs to affect the data
  So that the charts show what the controls say they show

  The analytics read API accepts `negateFilters` (invert the user's filter
  selection, wired to the toolbar toggle) and `traceIds` (narrow a graph to an
  explicit trace set). The legacy ClickHouse query builder implements both.
  They must survive the trip from the API input to the builder:

  1. The legacy shim forwards them verbatim.
  2. The routed fast paths (slim / rollup tables) do not implement them, so
     any query carrying either must route to the legacy fallback table for
     its source rather than silently ignoring the parameter.

  Background:
    Given a project with analytics data in ClickHouse

  @unit
  Scenario: Legacy shim forwards negated filters to the query builder
    Given a timeseries request with filters and negateFilters enabled
    When the legacy shim builds the query
    Then the builder receives negateFilters enabled
    And the resulting SQL inverts the filter selection

  @unit
  Scenario: Legacy shim forwards trace scoping to the query builder
    Given a timeseries request scoped to specific trace ids
    When the legacy shim builds the query
    Then the builder receives the trace ids

  @unit
  Scenario: Negated queries never route to the fast-path tables
    Given the event-sourced analytics read flag is enabled
    And a timeseries request that the rollup table could otherwise serve
    When the request carries negateFilters
    Then the query routes to the legacy fallback table for its metric source

  @unit
  Scenario: Trace-scoped queries never route to the fast-path tables
    Given the event-sourced analytics read flag is enabled
    And a timeseries request that the rollup table could otherwise serve
    When the request carries trace ids
    Then the query routes to the legacy fallback table for its metric source
