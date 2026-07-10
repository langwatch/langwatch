Feature: Claude Code telemetry turn bounding
  As LangWatch ingesting Claude Code session telemetry
  I want a single turn's log stream to fan out across ingest lanes and its
  span conversion to proceed in bounded batches that converge
  So that one pathological agentic turn cannot serialize all of its work
  behind one queue group or seize the workers converting it, while a turn of
  any size still converts fully.

  # Incident 2026-07-10: Claude Code logs arrive with no trace context; the
  # receiver already synthesizes one trace per TURN (session.id:prompt.id) and
  # groups turns into a session via the conversation id. But one agentic turn
  # can drive thousands of tool/model calls: every log record becomes a
  # recordLog command FIFO'd into the single per-trace command group (~2,000+
  # observed on one group), and the span-sync reactor re-reads the whole turn's
  # logs on every debounce. The converter's "a turn's log set is small and
  # bounded" assumption was the latent flaw. Trace ids must NOT be split further
  # - tool outputs are recovered from the next model call's request body within
  # the same trace's record set - so the bounding happens in the ingest lane and
  # the reactor, never in the trace identity. Mirrors the existing span-command
  # sharding (specs/event-sourcing/span-command-sharding.feature).
  #
  # The conversion was reworked from "cap truncates the turn" to "conversion
  # proceeds in bounded batches and converges": a turn of ANY size converts
  # fully while each reactor pass stays O(new records). The truncation marker no
  # longer means "records permanently dropped" - it means "conversion is behind,
  # continuing on the next event's debounce" and self-heals off once a later pass
  # catches up.
  #
  # Implementation:
  #   - Ingest-lane fan-out: logCommandGroupKey.ts derives the recordLog
  #     GroupQueue key `traceId:<shard>` (FNV-1a on the span id), wired in
  #     pipeline.ts when TRACE_LOG_PROCESSING_SHARDS > 1 (default 1 = off). The
  #     emitted log_record_received event keeps aggregateId = traceId, so the
  #     fold, the claude-span-sync reactor, and the UI are untouched.
  #   - Incremental conversion: the reactor pages a turn's marked logs in batches
  #     of CLAUDE_TURN_LOG_CAP records (default 2000, env
  #     LANGWATCH_CLAUDE_TURN_LOG_CAP), fetching each batch strictly after a
  #     persisted (TimeUnixMs, event.sequence) cursor, folding it against the
  #     carried conversion state (Redis, 48h TTL), and dispatching the spans. It
  #     loops while a full batch came back, up to MAX_CONVERSION_BATCHES_PER_JOB
  #     (default 25, env LANGWATCH_CLAUDE_TURN_MAX_BATCHES) per job, so one job
  #     converts up to 50k records; a larger turn converges on the next event's
  #     debounced job (every record fires a job). Cross-batch joins (a tool's
  #     output recovered from a later model call's request body) complete by
  #     re-emitting carried records; the deterministic span ids + completeness
  #     nudge make the later, more complete emission win the stored_spans dedup.
  #   - Behind marker: when a job exits still behind (full final batch + batch
  #     ceiling hit) the root span carries langwatch.claude_code.truncated_logs =
  #     true + langwatch.claude_code.dropped_log_count (the TRUE remaining), then
  #     is re-emitted with the marker OMITTED once a later pass drains the turn.
  #   - State-loss safety: a missing / corrupt conversion state re-converts the
  #     turn from the first record (cursor reset to zero); the deterministic span
  #     ids upsert the same spans, so the redraw is idempotent.

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
  # so the produced spans are identical by construction - the command handler
  # reads no per-trace state. A dedicated end-to-end test that ingests the same
  # turn through sharded and unsharded lanes and diffs the two span trees is a
  # tracked gap.
  @sharding @correctness @unimplemented
  Scenario: the converted turn is identical regardless of sharding
    Given the same Claude Code turn ingested with sharding disabled and enabled
    When the turn's spans are converted
    Then both ingestions produce the same root agent span and children
    And tool outputs recovered from later model calls are present in both

  # Covered by claudeCodeSpanSync.reactor.unit.test.ts: a turn larger than one
  # batch pages across bounded batches in one job and converges (all model/tool
  # spans present, nothing marked truncated); a turn that still exceeds the
  # per-job batch ceiling stamps the root truncated with the TRUE remaining
  # count and logs a warning; a subsequent job resumes from the persisted cursor,
  # drains the turn, and re-emits the root with the marker cleared. Each fetch is
  # bounded to one batch, so the workers stay responsive while the turn is live.
  @bounding @unit
  Scenario: a large turn converts fully across bounded batches
    Given a Claude Code turn whose log count exceeds one conversion batch
    When the span-sync conversion runs
    Then each pass converts at most one bounded batch of log records
    And the whole turn is converted across passes with no records dropped
    And the trace is marked behind only while the conversion has not caught up
    And the behind marker clears once a later pass drains the turn
    And the workers remain responsive while the turn is live

  # Covered by claude-code-turn-conversion.incremental.unit.test.ts (the
  # state-loss + equivalence property tests): losing the conversion state
  # re-converts the turn from the first record and produces the SAME spans as a
  # single whole-turn pass, because the span ids are deterministic and upsert
  # over themselves. The reactor unit test drives the reactor side (a store that
  # reads null resets the cursor to zero and refetches from the start).
  @bounding @unit
  Scenario: losing conversion state re-converts the turn identically
    Given a Claude Code turn partially converted across batches
    When the persisted conversion state is lost
    Then the next pass re-converts the turn from its first record
    And the converged spans are identical to a single whole-turn conversion

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
