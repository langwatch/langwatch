Feature: Claude Code telemetry turn bounding
  As LangWatch ingesting Claude Code session telemetry
  I want a single turn's log stream to fan out across ingest lanes and its
  span conversion to stay bounded
  So that one pathological agentic turn cannot serialize all of its work
  behind one queue group or seize the workers converting it.

  # Incident 2026-07-10: Claude Code logs arrive with no trace context; the
  # receiver already synthesizes one trace per TURN (session.id:prompt.id) and
  # groups turns into a session via the conversation id. But one agentic turn
  # can drive thousands of tool/model calls: every log record becomes a
  # recordLog command FIFO'd into the single per-trace command group (~2,000+
  # observed on one group), and the span-sync reactor re-reads the whole turn's
  # logs on every debounce. The converter's "a turn's log set is small and
  # bounded" assumption was the latent flaw. Trace ids must NOT be split further
  # — tool outputs are recovered from the next model call's request body within
  # the same trace's record set — so the bounding happens in the ingest lane and
  # the reactor, never in the trace identity. Mirrors the existing span-command
  # sharding (specs/event-sourcing/span-command-sharding.feature).
  #
  # Implementation:
  #   - Ingest-lane fan-out: logCommandGroupKey.ts derives the recordLog
  #     GroupQueue key `traceId:<shard>` (FNV-1a on the span id), wired in
  #     pipeline.ts when TRACE_LOG_PROCESSING_SHARDS > 1 (default 1 = off). The
  #     emitted log_record_received event keeps aggregateId = traceId, so the
  #     fold, the claude-span-sync reactor, and the UI are untouched.
  #   - Conversion bound: CLAUDE_TURN_LOG_CAP (default 2000, env
  #     LANGWATCH_CLAUDE_TURN_LOG_CAP) caps how many of a turn's marked logs the
  #     reactor folds; it fetches cap+1 (turn order), converts the first cap, and
  #     stamps the root span langwatch.claude_code.truncated_logs = true +
  #     langwatch.claude_code.dropped_log_count when the cap bites.

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

  # Sharding only changes the recordLog GroupQueue lane, never the record set the
  # span-sync reactor folds (it re-reads by the whole traceId) nor the converter,
  # so the produced spans are identical by construction — the command handler
  # reads no per-trace state. A dedicated end-to-end test that ingests the same
  # turn through sharded and unsharded lanes and diffs the two span trees is a
  # tracked gap.
  @sharding @correctness @unimplemented
  Scenario: the converted turn is identical regardless of sharding
    Given the same Claude Code turn ingested with sharding disabled and enabled
    When the turn's spans are converted
    Then both ingestions produce the same root agent span and children
    And tool outputs recovered from later model calls are present in both

  # Covered by claudeCodeSpanSync.reactor.unit.test.ts: an over-cap turn fetches
  # at most cap+1 records, converts only the first cap, stamps the root span
  # truncated with a dropped-log count, and logs a structured warning; an at/under
  # cap turn converts whole and marks nothing.
  @bounding @unit
  Scenario: a pathological turn's span conversion is bounded
    Given a Claude Code turn whose log count exceeds the per-turn conversion bound
    When the span-sync conversion runs
    Then the conversion processes at most the bounded number of log records
    And the produced trace is marked as truncated in an observable way
    And the workers remain responsive while the turn is live

  # The structural guarantee is covered by logCommandSharding.test.ts (the fold
  # stays keyed per trace, not per shard; the event aggregate is the bare trace)
  # and recordLogCommand.sharding.integration (unsharded collapses to the single
  # legacy trace group; AggregateId = traceId either way). The root/model/tool
  # spans carry the session id as gen_ai.conversation.id + langwatch.thread.id
  # (claude-code-log-to-span.ts baseAttrs / buildRootSpan), so the session view
  # is unchanged. Driving the actual product session view in a browser is a
  # tracked gap.
  @sharding @integration
  Scenario: session grouping is unchanged by sharding
    Given a session whose turns were ingested through sharded lanes
    When the session is viewed in the product
    Then every turn appears as one trace under the session's conversation
    And turn traces carry the session id as their thread linkage
