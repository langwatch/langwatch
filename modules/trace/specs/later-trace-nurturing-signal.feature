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

  # Keyed by the project and instant (2026-10-20): keyed by project alone, a busy project's
  # received-trace facts all queued behind each other in one queue group.
  @unit
  Scenario: A later trace's fact is keyed by its project and instant
    Given two later traces in the same project are received at different instants
    When their received facts are recorded
    Then each fact is keyed by the project and its instant, so neither waits for the other
    And the fact still names its project
