Feature: Oversized traces are processed lighter, never dropped
  As an operator running multi-tenant trace ingestion on shared infrastructure
  I want a runaway trace (a reused trace_id, an instrumentation loop) to stop
  paying expensive per-span processing once it is clearly pathological
  So that one trace cannot amplify shared work without bound, while every span
  is still stored and the trace stays fully queryable.

  # Why this exists — 2026-05-28 incident follow-up
  #
  # A reused trace_id accumulated tens of thousands of spans. The danger was
  # never the storage (ClickHouse handles volume) — it was the per-span
  # amplifying WORK: re-deriving the trace summary and re-firing every
  # ON_MESSAGE evaluator for each of 26k spans. The fix is to refuse the WORK,
  # never the DATA: past a processing cap a trace is handled lighter, but no
  # span is ever dropped.
  #
  # One shared threshold (MAX_PROCESSED_SPANS) governs both halves, so "this
  # trace is too big to keep processing" is decided in exactly one place:
  #   - the trace-summary fold already stops DERIVING past the cap (it keeps
  #     counting so true magnitude stays visible, but pays no derivation cost)
  #   - the evaluation trigger stops DISPATCHING evaluations past the same cap
  # Storage is untouched in both cases: every span is persisted regardless.
  #
  # This is NOT a dropping mechanism. Customers can send arbitrarily large
  # traces; we simply stop re-evaluating a runaway one. Lossless memory relief
  # for genuinely-large traces is handled separately (large-payload offload).

  # Storage is a separate projection from evaluation, so skipping evaluation can
  # never skip storage: every span is persisted regardless of trace size. That
  # is the no-drop guarantee — asserted by construction, not gated anywhere.

  Background:
    Given the trace-processing pipeline is running

  Rule: Evaluations stop firing once a trace passes the processing cap

    Scenario: Evaluations run for a trace under the processing cap
      Given a trace under the processing cap with enabled monitors
      When a new span arrives for that trace
      Then its enabled evaluations are dispatched

    Scenario: Evaluations are skipped for a trace over the processing cap
      Given a trace that has passed the processing cap with enabled monitors
      When a new span arrives for that trace
      Then no evaluation is dispatched for that span
      And the skip is recorded so the oversized trace stays visible
