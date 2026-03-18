@issue:1561
Feature: OTel tracing on ScenarioEventRepository methods
  As a developer debugging ES query latency
  I want all ScenarioEventRepository public methods to emit OTel spans
  So that distributed traces have no gaps when scenario events are queried

  # GitHub Issue: https://github.com/langwatch/langwatch/issues/1561
  #
  # Many public methods already have tracing. The remaining 6 public methods
  # lack tracer.withActiveSpan, creating gaps in distributed traces.
  # Each span must include db.system, db.operation, and tenant.id to match
  # the pattern established by saveEvent and other traced methods.

  Background:
    Given a ScenarioEventRepository instance with a configured tracer

  # ============================================================================
  # Span creation for each untraced public method
  # ============================================================================

  @unit
  Scenario Outline: <method> emits an OTel span with correct attributes
    When <method> is called
    Then a span named "ScenarioEventRepository.<method>" is created
    And the span has kind CLIENT
    And the span has attribute "db.system" set to "elasticsearch"
    And the span has attribute "db.operation" set to "<operation>"
    And the span has attribute "tenant.id" set to the project ID

    Examples:
      | method                          | operation |
      | getBatchRunIdsForScenarioSet    | SEARCH    |
      | getBatchRunIdsForAllSuites      | SEARCH    |
      | getBatchRunCountForScenarioSet  | SEARCH    |
      | getScenarioRunIdsForBatchRun    | SEARCH    |
      | getScenarioRunIdsForBatchRuns   | SEARCH    |
      | getMaxTimestampForBatchRun      | SEARCH    |
