@traces
Feature: An offloaded trace field reads whole through eventing's event read seat
  An oversized span attribute or log body is leaned to a 64 KB preview in the
  projections; the full value stays in the event that recorded it. Trace reads
  that event through the one-event read seat the process hands its registry
  (Q209, 2026-10-06), never through a query of its own over the event log, and
  asks only for events of its own trace aggregate. Where no event can be read
  the read raises and the caller keeps the preview.

  @unit
  Scenario: An offloaded field is read whole from its own trace event
    Given a span attribute offloaded under an event of trace "trace-1"
    When the trace read recalls that field
    Then the event read seat is asked for that event of the tenant's trace aggregate
    And the full value is served

  @unit
  Scenario: An event the seat cannot answer keeps the preview
    Given the event read seat cannot find the event, as outside its window
    When the trace read recalls the field
    Then the recall raises and the caller serves the preview

  @unit
  Scenario: A process on memory stores keeps the preview
    Given the trace repositories are selected on the memory tier
    When the trace read recalls an offloaded field
    Then the recall raises and the caller serves the preview
