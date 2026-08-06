# Trace list Events column — Gherkin Spec
# Implementation:
#   platform/app/src/features/traces-v2/components/TraceTable/registry/cells/trace/EventsCell.tsx
#   platform/app/src/features/traces-v2/hooks/useTraceListEvents.ts
#   platform/app/src/server/api/routers/tracesV2.ts (`listEvents`)
#   platform/app/src/server/app-layer/traces/repositories/span-storage.clickhouse.repository.ts
#
# Trace-level events are OTel span events, stored on `stored_spans`. They are
# deliberately NOT folded onto `trace_summaries` (that hoist grew the fold
# state O(span-count) and made folding O(n^2); migration 00025 dropped the
# columns), so anything showing them reads them back on demand.

Feature: Trace list Events column
  As a user scanning the trace list
  I want each row to show the events its trace recorded
  So that I can spot feedback, tool output and exceptions without opening every trace

Rule: The Events column shows the trace's own events
  What a row shows must agree with what the trace drawer's Events section
  shows for the same trace. A row that reads empty means the trace has no
  events, never that the list forgot to ask for them.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Events column is visible

  @integration
  Scenario: A trace with events shows a badge per event name
    Given a trace recorded one "thumbs_up_down" event
    When the trace list renders
    Then that row's Events column shows a "thumbs_up_down" badge

  @integration
  Scenario: A trace with no events shows the empty marker
    Given a trace recorded no events
    When the trace list renders
    Then that row's Events column shows the empty-cell marker

  @unit
  Scenario: Repeated events of the same name collapse into one badge with a count
    Given a trace recorded 237 "tool.output" events and 237 "gen_ai.request.attempt" events
    When the trace list renders
    Then that row shows a "tool.output" badge reading "237"
    And a "gen_ai.request.attempt" badge reading "237"
    # A badge per event would render 474 chips in a 250px cell.

  @unit
  Scenario: Badges are ordered by when the event first occurred
    Given a trace recorded "exception" after "first_token"
    When the trace list renders
    Then the "first_token" badge comes before the "exception" badge

  @unit
  Scenario: Overflowing badges collapse into a remainder chip
    Given a trace recorded events under 7 distinct names
    When the trace list renders
    Then the first 3 badges are shown
    And a "+4" chip stands for the rest
    And hovering the remainder chip names the events it stands for

  @integration
  Scenario: The list agrees with the drawer
    Given a trace whose drawer Events section lists 1 event
    Then that trace's row in the list shows 1 event

Rule: Events are read on demand, per visible page
  The events read is a second query, not part of the list read: the list is
  the query that gates first paint, and events live in a different table.

  Background:
    Given the user is authenticated with "traces:view" permission

  @integration
  Scenario: Events are fetched for the traces currently on screen
    Given the Events column is visible
    When a page of traces loads
    Then events are requested once for that page's trace ids

  @integration
  Scenario: Hiding the Events column stops the fetch
    Given no visible column or grouping needs events
    When a page of traces loads
    Then no events request is made

  @integration
  Scenario: Enabling the Events column triggers the fetch
    Given the Events column was hidden
    When the user enables the Events column
    Then events are requested for the traces already on screen
    And the trace list itself is not refetched

  @integration
  Scenario: The list still renders while events are in flight
    Given the events request has not resolved
    Then every other column renders its value
    And the Events column shows a pending placeholder rather than the empty marker
    # Showing the empty marker early would read as "this trace has no events".

  @integration
  Scenario: A failed events read leaves the rest of the list intact
    Given the events request fails
    Then the trace rows still render
    And the Events column shows the empty marker
    And no error toast interrupts the user
    # The column is supplementary; losing it must not take the list down.

Rule: Events reads are tenant-scoped and bounded
  The read goes to `stored_spans`, which is ordered by
  (TenantId, TraceId, SpanId) and partitioned by week.

  Background:
    Given a project with traces that carry span events

  @integration
  Scenario: Only the caller's project is read
    When events are read for a page of trace ids
    Then the query filters on the caller's TenantId first
    And trace ids belonging to another project return nothing

  @integration
  Scenario: The read is pruned to the page's time range
    When events are read for a page of trace ids
    Then the query is bounded by the list's time range
    And partitions outside that range are not scanned

  @integration
  Scenario: A trace with a very large number of events stays bounded
    Given a trace recorded events under more distinct names than a row can show
    When events are read for it
    Then the response carries at most the badge cap plus the remainder count
    And the row never receives one entry per event

  @integration
  Scenario: An empty page of trace ids skips the query entirely
    Given the visible page has no traces
    When the events read runs
    Then no ClickHouse query is issued

Rule: Conversation groups count the events of their turns
  The Conversations lens summarises each group, including how many events
  its traces recorded between them.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Conversations lens is active

  @unit
  Scenario: A group's event count sums its traces' events
    Given a conversation with two traces recording 2 and 3 events
    Then the conversation row shows 5 events

  @unit
  Scenario: A conversation whose traces recorded no events shows no counter
    Given a conversation whose traces recorded no events
    Then no event counter is shown on the conversation row
