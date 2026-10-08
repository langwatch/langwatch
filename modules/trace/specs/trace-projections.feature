Feature: Trace folds and span storage fold idempotently

  A span stored twice must not double a total, and a subscriber must only ever
  act on the origin it was built to guard. The trace analytics fold and rollup
  are analytics' (modules/analytics/specs/trace-analytics-ownership.feature).

  # span-storage.projection.ts,
  # custom-evaluation-sync.subscriber.ts, origin-guarded.subscriber.ts,
  # trace-attribute-cap.rules.ts, trace-payload-cap.rules.ts,
  # trace-retention-floor.service.ts

  @unit
  Scenario: The worker's trace folds read through the Redis fold cache under main's keyspaces
    Given the worker's trace pipeline built over the process's Redis
    When the summary fold stores one trace's state
    Then it is cached under main's keyspace, trace_summaries
    And a cache miss falls through to the durable projection

  @unit @unimplemented
  Scenario: A span exceeding the attribute cap is stored truncated, not rejected
    Given a span whose attributes exceed the cap
    When it is stored
    Then it is kept with its attributes truncated and the truncation is recorded

  @unit @unimplemented
  Scenario: A subscriber only acts on events from the origin it guards
    Given an event produced by another origin
    When the guarded subscriber receives it
    Then it takes no action

  @unit @unimplemented
  Scenario: A trace read below the retention floor returns nothing rather than stale data
    Given a project whose retention window has passed for a trace
    When the trace is read
    Then it is reported as unavailable

  @unit
  Scenario: A first trace on a deployment with no product-analytics sink logs no metadata failure
    Given no product-analytics sink is composed
    When a project's first real trace is processed
    Then the project is marked integrated
    And no "Failed to update project metadata" error is logged
