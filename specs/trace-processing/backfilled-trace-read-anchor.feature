Feature: A trace whose spans arrive late keeps its folded state

  The trace folds (traceSummary and traceAnalytics) file a trace's row under its
  storage anchor, the first business time they observe (ADR-087): for a trace
  with spans, the first span's start time. They read that row back within a
  window around the event they fold, and they trust a miss inside that window as
  proof that the trace has no row yet, so a brand-new trace never pays a second
  read.

  A trace imported or backfilled days after it happened broke that. A span's
  occurredAt is when it arrived, and the deferred origin check used to stamp
  its event with the time it ran. Centred on those, the read missed the row,
  the miss was trusted, the fold started empty and traceAnalytics wrote an
  empty row with a newer UpdatedAt over the real one. Dashboards read the
  newest row, so the trace vanished from every chart while trace search still
  found it.

  The row can sit near a span's arrival (a live trace, or one a log record
  opened) or near its start time (a backfill), so a span's read covers both.

  @unit
  Scenario: A fold's read window covers both occurred-at and the business time it declares
    Given a fold whose read window declares an anchor for each event
    When it folds an event whose anchor is earlier than its occurred-at
    Then the store read runs from the anchor minus the window width
    And it ends at the occurred-at plus the window width

  @unit
  Scenario: A fold without a declared anchor centres its read window on occurred-at
    Given a fold whose read window declares no anchor
    When it folds an event
    Then the store read is bounded to the event's occurred-at plus or minus the window width

  @unit
  Scenario: A trace fold anchors a span on the span's own start time
    Given a span that started nine days before it arrived
    When the trace folds compute the read anchor for its span-received event
    Then the anchor is the span's start time
    And an event that is not a span keeps its occurred-at as the anchor

  @unit
  Scenario: The deferred origin is stamped with the trace's storage anchor
    Given a trace whose summary was found with a storage anchor nine days ago
    And the summary has no origin when the deferred check fires
    When the deferred check resolves the origin as application
    Then the origin event's occurred-at is the trace's storage anchor

  @integration
  Scenario: A backfilled trace keeps its spans in trace analytics after its origin resolves
    Given a trace whose spans started nine days before they arrive
    When its spans are folded and the deferred check resolves its origin
    Then the newest trace_analytics row for the trace still counts its spans
    And that row carries the resolved origin
    And the trace counts in a 30-day trace analytics timeseries

  @integration
  Scenario: A live trace keeps its state when a span that started long before arrives
    Given a trace whose first span started now
    When a span that started nine days earlier arrives and the fold cache is cold
    Then the newest trace_analytics row for the trace counts both spans
    And the trace summary counts both spans
