Feature: Claude Code telemetry turn bounding
  As LangWatch ingesting Claude Code session telemetry
  I want a single turn's log stream to fan out across ingest lanes
  So that one pathological agentic turn cannot serialize all of its work
  behind one queue group and stall every tenant's processing.

  # Incident 2026-07-10: Claude Code logs arrive with no trace context; the
  # receiver already synthesizes one trace per TURN (session.id:prompt.id) and
  # groups turns into a session via the conversation id. But one agentic turn
  # can drive thousands of tool/model calls: every log record becomes a
  # recordLog command FIFO'd into the single per-trace command group (~2,000+
  # observed on one group). Trace ids must NOT be split further - tool outputs
  # are recovered from the next model call's request body within the same
  # trace's record set - so the fan-out happens in the ingest lane, never in
  # the trace identity. Mirrors the existing span-command sharding
  # (specs/event-sourcing/span-command-sharding.feature).
  #
  # Conversion-side boundedness is structural: the coding-agent session fold
  # consumes each log/span event incrementally into one bounded summary row,
  # so there is no whole-turn re-read to cap. See
  # specs/trace-processing/coding-agent-session.feature ("The summary stays
  # bounded no matter how long the session runs").
  #
  # Implementation:
  #   - Ingest-lane fan-out: logCommandGroupKey.ts derives the recordLog
  #     GroupQueue key `traceId:<shard>` (FNV-1a on the span id), wired in
  #     pipeline.ts via TRACE_LOG_PROCESSING_SHARDS (default 4, `1` disables).
  #     The emitted log_record_received event keeps aggregateId = traceId, so
  #     the folds and the UI are untouched.

  Background:
    Given a project receiving Claude Code telemetry

  # Covered by logCommandGroupKey.unit.test.ts (bucket distribution + trace
  # prefix), logCommandSharding.test.ts (the composition root installs the
  # sharded getGroupKey on recordLog), and recordLogCommand.sharding.integration
  # (live GroupQueue staging: records land in more than one
  # `trace:<traceId>:<shard>` group).
  @sharding @unit @integration
  Scenario: one turn's logs fan out across ingest lanes
    Given log-command sharding is enabled with more than one shard
    And a Claude Code turn streaming thousands of log records
    When the records are staged for processing
    Then the records distribute across the turn's shard groups
    And no single queue group serializes the whole turn
    And the emitted events still aggregate under the turn's single trace

  # Sharding only changes the recordLog GroupQueue lane, never the record set
  # the session fold consumes (events aggregate under the whole traceId), so
  # the summarised session is identical by construction - the command handler
  # reads no per-trace state. A dedicated end-to-end test that ingests the same
  # turn through sharded and unsharded lanes and diffs the two summaries is a
  # tracked gap.
  @sharding @correctness @unimplemented
  Scenario: the converted turn is identical regardless of sharding
    Given the same Claude Code turn ingested with sharding disabled and enabled
    When the turn's telemetry is summarised
    Then both ingestions produce the same session summary
    And tool outputs recovered from later model calls are present in both

  # The structural guarantee is covered by logCommandSharding.test.ts (the fold
  # stays keyed per trace, not per shard; the event aggregate is the bare trace)
  # and recordLogCommand.sharding.integration (unsharded collapses to the single
  # legacy trace group; AggregateId = traceId either way). The root/model/tool
  # spans carry the session id as gen_ai.conversation.id + langwatch.thread.id,
  # so the session view is unchanged. Driving the actual product session view
  # in a browser is a tracked gap.
  @sharding @integration
  Scenario: session grouping is unchanged by sharding
    Given a session whose turns were ingested through sharded lanes
    When the session is viewed in the product
    Then every turn appears as one trace under the session's conversation
    And turn traces carry the session id as their thread linkage
