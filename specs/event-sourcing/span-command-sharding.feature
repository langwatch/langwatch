Feature: Sharded span-command processing

  `recordSpan` commands are grouped on the GroupQueue by a key derived from the
  trace id, so every span of a trace lands in one group and drains one at a time
  behind a single worker. Each span's per-span work — PII redaction, cost
  enrichment, token estimation, content-drop — runs serially, which is fine for
  an ordinary trace but not for one that accumulates thousands of spans.

  # Why this exists — hot-trace command backlog
  #
  # A single trace with a reused trace_id (or a runaway agent loop) can queue
  # thousands of recordSpan commands into one group. Observed live: ~6.5k
  # commands pending on one group, oldest 11 minutes, while every other trace's
  # spans waited their turn behind it. The command handler reads no trace-level
  # state — it is a pure per-span transform that emits one span_received event
  # stamped with the trace as its aggregate — so the *command* need not serialise
  # on the trace. Only the trace-summary *fold* does, and it runs on its own
  # aggregate-keyed queue. Splitting the command's group key into
  # `traceId:<shard>` lets a hot trace's spans drain across several groups in
  # parallel while the fold stays ordered per trace and the summary stays exact.
  #
  # Sharding is off by default (one shard = the historic trace-only key) and is
  # raised by an operator. The per-tenant soft-cap still bounds how many of a
  # tenant's groups run at once, so a fanned-out hot trace cannot starve its
  # neighbours — see tenant-soft-cap.feature.

  Background:
    Given the trace-processing pipeline records spans via the recordSpan command

  @unit @sharding
  Scenario: Sharding disabled keeps the historic trace-only group key
    Given span-command sharding is disabled
    When the group key is derived for any span of a trace
    Then the group key is the trace id alone
    And every span of that trace shares one processing group

  @unit @sharding
  Scenario: Sharding spreads a trace's spans across groups
    Given span-command sharding is enabled with several shards
    When the group keys are derived for many spans of one trace
    Then the spans are spread across more than one processing group
    And no group key exceeds the configured shard count

  @unit @sharding
  Scenario: A span always maps to the same shard
    Given span-command sharding is enabled
    When the group key is derived twice for the same span
    Then both derivations yield the same group
    And the span's retries and dedup window stay in that one group

  @unit @sharding
  Scenario: The configured shard count is clamped to a safe range
    Given an operator-supplied shard count that is absent, non-numeric, or below one
    Then the resolved shard count falls back to one, leaving sharding disabled
    And a shard count above the maximum is clamped down to the maximum

  @integration @sharding @pipeline
  Scenario: The pipeline shards the command while leaving the fold per-trace
    Given the pipeline is built with several shards
    When the recordSpan command's group key is derived for two different spans of one trace
    Then the two spans can resolve to different groups
    But the trace-summary fold's key remains the trace alone

  @integration @sharding @pipeline
  Scenario: The pipeline preserves the trace-only key when sharding is off
    Given the pipeline is built with sharding disabled
    When the recordSpan command's group key is derived for any span of a trace
    Then the group key is the trace id alone, identical to before sharding existed

  @integration @sharding @correctness
  Scenario: The trace summary is exact regardless of sharding
    Given many spans recorded for one trace with sharding enabled
    When the spans are processed in parallel across shards
    And the trace-summary fold catches up
    Then the accumulated span count equals the number of spans recorded
