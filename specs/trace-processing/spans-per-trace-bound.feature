Feature: Per-trace span bound on ingestion
  As an operator running multi-tenant trace ingestion on shared infrastructure
  I want a hard ceiling on how many spans a single trace_id can accumulate
  So that one runaway trace (a reused trace_id, an instrumentation loop,
  an accidental fan-out) cannot balloon the fold backlog, span storage, and
  Redis memory and degrade ingestion for every other tenant.

  # Why this exists — incident 2026-05-28
  #
  # A trace_id reused across days accumulated tens of thousands of spans. Every
  # span became a queued fold job, so that one trace's fold backlog grew to
  # hundreds of KB (heavy tail past 2 MB) of Redis state that re-piled on each
  # ingest. Under a concurrent dispatch stall it could not drain, the shared
  # single-threaded Redis filled toward its no-eviction ceiling, and span
  # ingestion was rejected at the door for everyone. The per-tenant soft cap
  # (see event-sourcing/tenant-soft-cap.feature) bounds how many groups a tenant
  # holds in flight; it does not bound how large a single trace can get. This is
  # the missing second ceiling.
  #
  # Two tiers, distinct jobs:
  #   - The processing cap (512) stops DERIVING a trace summary past 512 spans:
  #     the fold keeps counting so true magnitude stays visible, but it no longer
  #     pays normalization cost. It does NOT bound storage or the queue.
  #   - The ingestion bound (this feature) is the hard ceiling: past it, further
  #     spans for the trace are dropped at ingestion — never queued, never stored,
  #     never folded — so a single trace cannot grow shared infra without limit.
  #
  # The bound ships ON by default, sized far above any legitimate trace so only
  # pathological reuse/loops hit it. Operators can retune it; a single trace
  # hitting the bound never affects other traces or tenants.

  Background:
    Given the trace-processing ingestion pipeline is running

  Rule: A trace stops accepting spans once it reaches the ingestion bound

    Scenario: Spans within the bound are ingested normally
      Given a trace under its span ingestion bound
      When a new span arrives for that trace
      Then the span is ingested, stored, and folded into the trace summary

    Scenario: Spans past the bound are dropped at ingestion
      Given a trace that has reached its span ingestion bound
      When a further span arrives for that trace
      Then the span is not stored, not queued, and not folded
      And the drop is recorded so the trace's true magnitude stays visible

    Scenario: Dropping one trace's overflow does not affect other traces
      Given one trace that has reached its span ingestion bound
      And a second trace from the same tenant well under the bound
      When spans arrive for both traces
      Then the second trace's span is ingested normally
      And only the over-bound trace's span is dropped

  Rule: The bound is observable, not silent

    Scenario: Crossing the bound is logged once, not per dropped span
      Given a trace that has just reached its span ingestion bound
      When many further spans arrive for that trace
      Then the bound breach is logged when first crossed
      And the per-span drops do not each emit their own log line

  Rule: The bound is configurable with a safe default

    Scenario: The bound defaults ON when unconfigured
      Given the span ingestion bound is not explicitly configured
      When the pipeline reads the bound
      Then it returns the built-in default ceiling

    Scenario: An operator can retune the bound
      Given the span ingestion bound is configured to a custom ceiling
      When the pipeline reads the bound
      Then it returns the configured ceiling
