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
  Scenario: Spans stored at the slice edges of a 600-span batch are not written again
    Given the spans at the slice edges of a 600-span batch stored by an earlier batch
    When the 600-span batch is appended
    Then span_analytics holds each of the 600 spans once

  @unit
  Scenario: A batch that mixes tenants is refused
    Given a batch carrying spans of two tenants
    When the batch is appended
    Then it is refused before any lookup runs

  @unit
  Scenario: Another tenant's span with the same ids is still written
    Given a span stored for one tenant
    When a later batch carries a span of another tenant with the same trace and span ids
    Then the other tenant's span is written

  @integration
  Scenario: A re-sent span is written once in ClickHouse
    Given a span stored in span_analytics
    When the same span is re-sent, with the same and with a different start time inside the window
    Then span_analytics holds one row for the span

  @integration
  Scenario: Another tenant's span with the same ids is not matched
    Given a span stored for one tenant
    When another tenant sends a span with the same trace and span ids
    Then the other tenant's span is stored and each tenant holds one row

  @unit
  Scenario: A span redelivered after a failed insert is written once
    Given an insert that fails after the lookup
    When the same span is redelivered
    Then the lookup bound is the same and span_analytics holds the span once
