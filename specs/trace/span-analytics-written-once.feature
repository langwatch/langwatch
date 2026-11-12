Feature: span_analytics holds each span once

  The spanAnalytics map looks up stored span keys before it appends, so a plain
  read of span_analytics counts each span once without FINAL. The first write wins.
  This holds except for the residuals in ADR-034 (amendment, 2026-11-12): read lag,
  overlapping redeliveries and a StartTime moved over seven days.

  @unit
  Scenario: A span repeated inside one batch is written once
    Given a batch carrying the same span twice
    When the batch is appended
    Then span_analytics holds the span once

  @unit
  Scenario: A span already stored is not written again
    Given a span stored by an earlier batch
    When a later batch carries the same span
    Then span_analytics holds the span once

  @unit
  Scenario: A re-sent span whose start time moved by under seven days is found
    Given a span stored by an earlier batch
    When a later batch carries the same span with a start time five days later
    Then span_analytics holds one copy of the span

  @unit
  Scenario: A span re-sent with a StartTime moved more than 7 days is written twice
    Given a span stored by an earlier batch
    When a later batch carries the same span with a start time eight days later
    Then span_analytics holds two copies of the span

  @unit
  Scenario: Each slice of 256 spans is looked up under its own start time bound
    Given a batch of 600 spans over 60 days
    When the batch is appended
    Then three lookups run, each bounded by its slice's start times plus or minus seven days

  @unit
  Scenario: A span redelivered after a failed insert is written once
    Given an insert that fails after the lookup
    When the same span is redelivered
    Then the lookup bound is the same and span_analytics holds the span once
