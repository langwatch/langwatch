Feature: A later trace tells nurturing, against the organization's admin

  Once a project's first trace already integrated it, every further real
  trace tells nurturing once against the organization's admin: main's
  customerIoTraceSync last_trace_at update, ported as a signal (§9).

  @unit
  Scenario: A later trace tells nurturing against the organization's admin
    Given a project that already received its first message
    When another real trace is processed through the trace-processing pipeline
    Then nurturing receives trace_received against the organization's admin

  @unit
  Scenario: A later trace in a project with no organization admin tells nurturing nothing
    Given a project that already received its first message and resolves no organization admin
    When another real trace is processed
    Then nurturing receives nothing
