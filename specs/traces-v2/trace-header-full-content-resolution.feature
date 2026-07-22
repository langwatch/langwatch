Feature: Trace header resolves full offloaded input/output
  As a user opening a trace in the (v2) Trace Explorer
  I want the drawer to show the complete input/output, not just the ≤64KB
  preview stored for fast list reads
  So that I can read what was actually sent even when it was too large to
  keep in full in the fast summary table

  # Gap found while investigating a customer report about the Trace
  # Explorer showing truncated input: the legacy `traces.getById` procedure
  # already resolves offloaded (ADR-022) content in full for a single-trace
  # read (recordSpanCommand -> event_log -> resolve-offloaded-traces.ts).
  # The newer tracesV2 `header` procedure (the one the current, non-legacy
  # Trace Explorer actually uses) never got this: it reads only
  # trace_summaries.ComputedInput/ComputedOutput, which is deliberately
  # capped to a ~64KB preview for fast list-view reads. Opening a trace
  # whose IO was offloaded showed the same ~64KB preview as the list row,
  # with no way to see the rest — even for projects with
  # release_trace_blob_offload on, where the full content is sitting intact
  # in event_log the whole time.
  #
  # Fix: TraceSummaryService.getByTraceId gains an optional `full` read,
  # mirroring the exact pattern SpanStorageService already uses for
  # per-span resolution — same resolveOffloadedTraces() primitive, no
  # duplicated logic. The v2 header procedure (single-trace read only,
  # never the list) requests `full: true` unconditionally, exactly like
  # legacy traces.getById already does.

  Background:
    Given a trace whose langwatch.input was offloaded to event_log at
        ingestion (release_trace_blob_offload was on)
    And trace_summaries.ComputedInput holds only the ≤64KB preview

  Scenario: Opening the trace header resolves the full input
    When the tracesV2 header procedure reads this trace
    Then the returned input is the full original value, not the preview
    And the full value is resolved by reading the trace's spans, finding
        the langwatch.reserved.eventref.langwatch.input pointer, and
        fetching the referenced event from event_log

  Scenario: A trace with no offloaded content is read without extra cost
    Given a trace whose input never exceeded the preview threshold
    When the tracesV2 header procedure reads this trace
    Then the returned input matches trace_summaries.ComputedInput directly
    And no event_log read occurs (resolveOffloadedTraces' fast-path: no span
        carries an eventref)

  Scenario: A missing or unreadable event_log row does not break the read
    Given a trace whose eventref points at an event_log row that no longer
        exists
    When the tracesV2 header procedure reads this trace
    Then the header is still returned successfully
    And the returned input falls back to the stored ≤64KB preview

  Scenario: The list view is unaffected
    Given the same offloaded trace as above
    When the trace list is read (not a single-trace header read)
    Then the list row still shows only the ≤64KB preview
    And no additional event_log or spans read occurs for that row
