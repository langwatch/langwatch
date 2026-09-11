Feature: Allowed aggregations are enforced per metric

  Every analytics metric declares which aggregations are valid for it in the
  metric registry (`allowedAggregations`), but historically nothing on the
  server enforced that declaration: an invalid pairing passed straight through
  to the query builder and failed inside ClickHouse with
  ILLEGAL_TYPE_OF_ARGUMENT. The request schema now derives its validation from
  the registry, so an invalid pairing is rejected with a validation error
  before any SQL is built. Stored-graph paths (report charts, graph trigger
  evaluation) construct series from stored JSON rather than a parsed request,
  so they parse through the same schema before dispatching.

  # ---------------------------------------------------------------------------
  # Schema boundary (tRPC + REST both parse through seriesInput)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A metric paired with an aggregation outside its allowed set is rejected
    Given the analytics metric registry
    When a series pairs a metric with an aggregation its allowedAggregations does not contain
    Then the schema rejects it with a validation error on the aggregation field
    And the error names the metric and its allowed aggregations
    And no SQL is built for the request

  @unit
  Scenario: Every aggregation a metric allows still validates
    Given the analytics metric registry
    When a series pairs a metric with any aggregation from its allowedAggregations
    Then the schema accepts it

  @unit
  Scenario: The legacy terms alias keeps validating wherever cardinality is allowed
    Given the query layer executes the terms aggregation as cardinality
    When a stored series pairs a cardinality-only metric with the terms aggregation
    Then the schema accepts it, so pre-rename stored graphs keep working

  # ---------------------------------------------------------------------------
  # Stored-graph paths (saved dashboards bypass the request schema)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A report chart whose stored series pairs a disallowed aggregation fails validation before querying
    Given a report whose stored graph pairs a metric with a disallowed aggregation
    When the report's charts are built
    Then building fails with a validation error
    And no timeseries query is dispatched

  @unit
  Scenario: A graph trigger whose stored series pairs a disallowed aggregation skips instead of querying
    Given a graph trigger whose stored graph pairs a metric with a disallowed aggregation
    When the trigger is evaluated
    Then the evaluation is skipped with a detail naming the invalid pairing
    And no timeseries query is dispatched
