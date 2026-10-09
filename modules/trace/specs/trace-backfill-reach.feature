Feature: An in-process backfill reaches past the OTLP door's 31 days
  The seed backfills old telemetry so retention can be tested (dev/docs/plans/seed-2026-10-09.md,
  Q1 (a) and ruling 7). Only an in-process caller sets the reach; the public door never does.

  @unit
  Scenario: An in-process backfill admits spans older than the door's 31 days
    Given an OTLP export whose span started 90 days ago
    When it is handed to TraceApi.otlpTraces with a backfill reach of 120 days
    Then the span is recorded
    And with a reach of 60 days, or past the 365-day ceiling, it is dropped as too old
    And the public OTLP door hands every export on with no backfill reach
