Feature: recordSpan GroupQueue staging bounds the data hash by span identity
  As an operator running the LangWatch event-sourcing pipeline
  I want the `recordSpan` command's GroupQueue staging hash to hold at most
  one entry per `(tenant, trace, span)` identity within the dedup window
  So that any at-least-once redelivery or a customer retry loop cannot grow a
  single Redis hash unboundedly until the instance runs out of memory

  # =========================================================================
  # Why this exists
  # =========================================================================
  #
  # The event-sourcing GroupQueue stages each dispatched command in a Redis
  # hash keyed by group. Each staged job gets a fresh `stagedJobId` (UUID)
  # and is written as a new HSET field unless STAGE_LUA's dedup branch fires.
  # The dedup branch only fires when the command was registered with a
  # `deduplication` strategy.
  #
  # The `recordSpan` command was registered without any deduplication
  # strategy. Two callers exposed the consequence:
  #
  #   - The REST `/api/collector` and `/api/track_event` paths dispatch
  #     `recordSpan` directly. Before PR #4677 they had no ingestion-layer
  #     gate either — a customer SDK retrying the same span every few seconds
  #     accumulated tens of thousands of fields in a single GroupQueue
  #     `:data` hash (peak observed: 291,932 fields, ~3.9 GB on a single
  #     trace).
  #
  #   - Any producer that re-dispatches `recordSpan` from INSIDE the worker
  #     runs past the ingestion gate — a process manager, a subscriber, or a
  #     retried job re-emitting the same span identity. Every such dispatch
  #     enqueues a fresh `recordSpan` job in Redis between dispatch and the
  #     ClickHouse write, accumulating per identity even though
  #     `ReplacingMergeTree` collapses the duplicates at storage time.
  #
  # PR #4677 closed the REST/OTLP ingestion gate via `SpanDedupService`.
  # That gate prevents customer retries from reaching the GroupQueue at all.
  # Worker-side redelivery runs past that gate, and so requires the
  # GroupQueue-layer dedup as defense-in-depth.
  #
  # =========================================================================
  # Behavior
  # =========================================================================
  #
  # Same `(tenant, trace, span)` identity dispatched within the dedup TTL
  # window MUST squash into the existing staged job (latest payload wins),
  # leaving a single HSET field in the group `:data` hash. Distinct identities
  # MUST each get their own HSET field — the gate must not over-deduplicate.

  Background:
    Given the `recordSpan` command is registered in the trace-processing pipeline
    And the command's GroupQueue staging uses a deterministic dedup identity
      built from `(tenantId, traceId, spanId)`

  @regression @integration
  Scenario: Repeated dispatches of the same span identity collapse to one staged entry
    Given a tenant, trace, and span identity
    When the same `recordSpan` payload is dispatched multiple times within the dedup window
    Then the group `:data` hash holds exactly one entry for that identity
    And the latest payload wins on replace

  @integration
  Scenario: Distinct span identities on the same trace each get their own staged entry
    Given a tenant and trace
    And multiple distinct span identities on that trace
    When each identity is dispatched once
    Then the group `:data` hash holds one entry per distinct identity
