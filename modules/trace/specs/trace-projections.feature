Feature: Trace rollups and span storage fold idempotently

  A trace rolled up or a span stored twice must not double a total, and a
  subscriber must only ever act on the origin it was built to guard.

  # trace-rollup.projection.ts, span-storage.projection.ts,
  # custom-evaluation-sync.subscriber.ts, origin-guarded.subscriber.ts,
  # trace-attribute-cap.service.ts, trace-payload-cap.rules.ts,
  # trace-cold-scan-detector.service.ts, trace-retention-floor.service.ts

  @unit @unimplemented
  Scenario: A trace rolled up twice reports one set of totals, not doubled ones
    Given a trace whose spans have already been rolled up
    When the same spans are folded again
    Then the totals are unchanged

  @unit
  Scenario: A trace rollup projection totals a call the same as every other pricing surface
    Given one model call priced by every server-side surface
    When the rollup projection totals it
    Then its total matches every other surface's price for the same call

  @unit @unimplemented
  Scenario: A late-arriving span updates the rollup it belongs to
    Given a trace already rolled up
    When a further span for that trace arrives
    Then the rollup includes it

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
