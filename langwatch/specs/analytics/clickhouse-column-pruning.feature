Feature: ClickHouse analytics column pruning
  Analytics aggregation queries deduplicate trace_summaries through a subquery
  before aggregating. That subquery must read only the columns the query
  actually uses, so a large tenant's metrics do not materialise wide unused
  columns (most importantly the Attributes map) for every trace in range and
  exceed the per-query memory limit.

  Background:
    Given a timeseries analytics query over trace_summaries

  Scenario: The dedup subquery never selects all columns
    When the query is built
    Then the trace_summaries dedup subquery does not use SELECT *
    And it always includes the identity columns TenantId, TraceId, OccurredAt and UpdatedAt
    And it never includes wide payload columns such as ComputedInput or ComputedOutput

  Scenario: A summary query reads only the columns it references
    Given a summary query that counts distinct traces and users and sums cost
    When the query is built
    Then the dedup subquery keeps TotalCost and the Attributes map
    And it drops unused columns such as NonBilledCost, Models, ErrorMessage and TokensPerSecond

  Scenario: A purely numeric metric does not read the Attributes map
    Given a query that only sums total cost with no grouping or metadata filter
    When the query is built
    Then the dedup subquery keeps TotalCost
    And it does not read the Attributes map

  Scenario: Grouping and filtering keep the columns they reference
    Given a query grouped by or filtered on a metadata attribute
    When the query is built
    Then the dedup subquery keeps the Attributes map
    And a query grouped by an evaluation field keeps that evaluation column

  Scenario: Pruned queries stay correct
    When any pruned query is executed against ClickHouse
    Then every referenced column resolves from the deduped subquery
    And the aggregated results match the unpruned query
