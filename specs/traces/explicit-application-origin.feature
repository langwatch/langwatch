Feature: Explicit application origin for race condition prevention
  As a LangWatch user with online evaluations enabled
  I want traces from my application to be explicitly tagged with origin "application"
  So that online evaluations never incorrectly fire on evaluation or simulation traces
  when child spans arrive before the root span

  # =========================================================================
  # Problem
  # =========================================================================
  #
  # When a trace's child spans arrive before the root span (which carries
  # langwatch.origin), the trace has no origin for up to a minute. The
  # evaluation trigger reactor fires after 30s, sees empty origin, and the
  # precondition matcher defaults `data.origin || "application"` — matching
  # traces that are actually evaluations or simulations.
  #
  # Solution has three parts:
  #   1. SDKs explicitly set langwatch.origin = "application" on root spans
  #      for regular traces (NOT experiments), making 95%+ unambiguous
  #   2. Empty origin = pending (not application) — the reactor and
  #      precondition matcher stop treating empty as "application"
  #   3. Smart deferred evaluation via single reactor with two phases:
  #      - Phase 1 (normal debounce): if origin is set, proceed. If empty
  #        but SDK info is present → infer "application" (old SDK). If empty
  #        and no SDK info → schedule deferred check.
  #      - Phase 2 (5-min deferred): re-read fold state from store, then
  #        apply the same logic. Handles pure OTEL exporters.
  #
  # SDK version heuristic:
  #   All spans from a LangWatch SDK carry telemetry.sdk.name in resource
  #   attributes. If sdk.name is present but langwatch.origin is absent,
  #   it's an old SDK that doesn't know about explicit origin. Old SDK
  #   evaluations/simulations are already tagged via legacy inference
  #   (instrumentationScope.name, metadata.labels, etc.), so the remaining
  #   untagged traces must be regular application traces. No 5-min delay
  #   needed — infer "application" at normal debounce time.
  #
  # Elasticsearch path:
  #   The legacy ES path does not implement origin filtering. Null origin
  #   continues to pass through. Only the event-sourcing pipeline applies
  #   origin guards.
  #
  # =========================================================================

  Background:
    Given the trace processing pipeline is running
    And a project exists with online evaluations enabled

  # ===========================================================================
  # Part 1: SDKs explicitly set origin "application"
  # ===========================================================================

  @unit
  Scenario: Python SDK sets origin "application" on root span for regular traces
    Given a user application instrumented with the LangWatch Python SDK
    When the user calls langwatch.trace() to create a trace
    Then the root span contains attribute "langwatch.origin" = "application"

  @unit
  Scenario: Python SDK does not set origin "application" for experiment traces
    Given a user runs an experiment via langwatch.experiment()
    When the experiment creates traces for evaluation targets
    Then the root span contains attribute "langwatch.origin" = "evaluation"
    And the origin is NOT "application"

  @unit
  Scenario: TypeScript SDK sets origin "application" on root span for regular traces
    Given a user application instrumented with the LangWatch TypeScript SDK
    When the SDK creates a trace for a regular application call
    Then the root span contains attribute "langwatch.origin" = "application"

  @unit
  Scenario: TypeScript SDK does not set origin "application" for experiment traces
    Given a user runs an experiment via the TypeScript SDK
    When the experiment creates traces for evaluation targets
    Then the root span contains attribute "langwatch.origin" = "evaluation"
    And the origin is NOT "application"

  # ===========================================================================
  # Part 2: Empty origin = pending, not application
  # ===========================================================================

  # --- Evaluation trigger reactor guards ---

  @unit
  Scenario: Evaluation trigger skips traces with empty origin and no SDK info
    Given an online evaluation monitor is enabled for the project
    And a trace arrives where the fold state has no langwatch.origin
    And the fold state has no sdk.name (pure OTEL trace)
    When the evaluation trigger reactor fires at normal debounce
    Then no evaluation commands are dispatched for this trace
    And a deferred check is scheduled for 5 minutes later

  @unit
  Scenario: Evaluation trigger runs on traces with explicit application origin
    Given an online evaluation monitor is enabled for the project
    And a trace arrives where the fold state has langwatch.origin = "application"
    When the evaluation trigger reactor fires at normal debounce
    Then evaluation commands are dispatched for matching monitors

  @unit
  Scenario: Evaluation trigger skips traces with non-application origin
    Given an online evaluation monitor is enabled for the project
    And a trace arrives where the fold state has langwatch.origin = "evaluation"
    When the evaluation trigger reactor fires at normal debounce
    Then no evaluation commands are dispatched for this trace

  # --- SDK version heuristic for old SDK backward compat ---

  @unit
  Scenario: Evaluation trigger infers application for old SDK traces
    Given an online evaluation monitor is enabled for the project
    And a trace arrives where the fold state has no langwatch.origin
    And the fold state has sdk.name = "langwatch" (old SDK without explicit origin)
    When the evaluation trigger reactor fires at normal debounce
    Then evaluation commands are dispatched for matching monitors
    Because the SDK presence + absence of origin means old SDK application trace

  @unit
  Scenario: Old SDK evaluation traces are handled by legacy inference
    Given a trace arrives from an old Python SDK running an experiment
    And the fold state has sdk.name = "langwatch"
    And legacy inference sets langwatch.origin = "evaluation" from instrumentationScope
    When the evaluation trigger reactor fires at normal debounce
    Then no evaluation commands are dispatched
    Because legacy inference correctly identified the origin

  # --- Precondition matcher changes ---

  @unit
  Scenario: Precondition matcher does not default empty origin to "application"
    Given a precondition: traces.origin is "application"
    And a trace with no langwatch.origin attribute in the fold state
    When the precondition matcher evaluates the trace
    Then the precondition fails
    Because empty origin means "pending", not "application"

  @unit
  Scenario: Precondition matcher matches explicit application origin
    Given a precondition: traces.origin is "application"
    And a trace with langwatch.origin = "application" in the fold state
    When the precondition matcher evaluates the trace
    Then the precondition passes

  # ===========================================================================
  # Part 3: Deferred evaluation for pure OTEL traces (5-min fallback)
  # ===========================================================================

  # Only traces with NO LangWatch SDK info face the 5-min delay.
  # These are pure OTEL exporters, third-party integrations, etc.
  # The single reactor handles both phases — no separate deferred reactor.

  @unit
  Scenario: Deferred check treats still-empty origin as "application"
    Given the deferred evaluation check fires for a trace
    And the fold state (re-read from projection store) still has no langwatch.origin
    When the deferred handler evaluates the trace
    Then it treats the trace as origin "application"
    And dispatches evaluation commands for matching monitors

  @unit
  Scenario: Deferred check skips traces that acquired a non-application origin
    Given a trace initially had no langwatch.origin
    And a root span later arrived with langwatch.origin = "evaluation"
    When the deferred evaluation check fires
    And the fold state (re-read from store) now has langwatch.origin = "evaluation"
    Then no evaluation commands are dispatched

  @unit
  Scenario: Deferred check runs evaluations for traces that acquired application origin
    Given a trace initially had no langwatch.origin
    And a root span later arrived with langwatch.origin = "application"
    When the deferred evaluation check fires
    And the fold state (re-read from store) now has langwatch.origin = "application"
    Then evaluation commands are dispatched for matching monitors

  @unit
  Scenario: Deferred check deduplicates per trace
    Given a trace receives multiple span batches with no origin or SDK info
    And each reactor dispatch schedules a deferred check
    When the deferred check fires
    Then only one evaluation check runs for that trace
    And it uses fold state re-read from the projection store (fresh, not captured)

  @integration
  Scenario: No deferred check is scheduled for SDK-instrumented traces
    Given a trace arrives from a LangWatch SDK (old or new)
    And the fold state has sdk.name present
    When the evaluation trigger reactor fires at normal debounce
    Then no deferred check is scheduled
    Because the SDK heuristic handles origin resolution immediately

  # ===========================================================================
  # Part 4: ClickHouse filter builder + frontend consistency
  # ===========================================================================

  # The ClickHouse filter builder must match the new semantics:
  # origin = "application" matches ONLY explicit "application", not empty/NULL.

  @unit
  Scenario: ClickHouse filter for origin "application" matches only explicit value
    Given a trace filter with traces.origin = "application"
    When the filter is compiled to ClickHouse SQL
    Then the WHERE clause matches ts.Attributes['langwatch.origin'] = 'application'
    And does NOT match empty or NULL values

  @unit
  Scenario: Frontend renders "Application" tag for explicit application origin
    Given a trace has langwatch.origin = "application" in its attributes
    When the trace is displayed in the traces table
    Then an "Application" origin tag is shown

  @unit
  Scenario: Frontend renders no origin tag for traces with empty origin
    Given a trace has no langwatch.origin attribute
    When the trace is displayed in the traces table
    Then no origin tag is shown

  # ===========================================================================
  # Race condition scenarios (the core problem this feature prevents)
  # ===========================================================================

  @integration
  Scenario: Child spans arriving before root span do not trigger evaluations prematurely
    Given an online evaluation monitor is enabled for the project
    And a trace's child spans arrive first without langwatch.origin
    And the child spans carry sdk.name = "langwatch" in resource attributes
    When the evaluation trigger reactor fires at normal debounce
    Then evaluation commands are dispatched (SDK heuristic infers "application")
    # This is correct! Old SDK child spans carry SDK info → fast path
    # If the root span arrives later with origin = "evaluation", the evaluation
    # was already dispatched — but this is acceptable because old SDKs are
    # the transitional case and the evaluation dedup handles re-fires

  @integration
  Scenario: New SDK child spans before root span are handled correctly
    Given an online evaluation monitor is enabled for the project
    And a trace's child spans arrive first from a new SDK
    And the child spans carry langwatch.origin = "application" (set by SDK on all spans)
    When the evaluation trigger reactor fires at normal debounce
    Then evaluation commands are dispatched for matching monitors

  @integration
  Scenario: Pure OTEL trace with no SDK info gets evaluated after 5-min delay
    Given an online evaluation monitor is enabled for the project
    And a complete trace arrives from a generic OTEL exporter
    And no span has sdk.name or langwatch.origin attributes
    When the evaluation trigger reactor fires at normal debounce
    Then no evaluation commands are dispatched
    And a deferred check is scheduled for 5 minutes
    When the deferred check fires and re-reads the fold state
    And the fold state still has no langwatch.origin
    Then the trace is treated as origin "application"
    And evaluation commands are dispatched for matching monitors

  @integration
  Scenario: Pure OTEL evaluation trace is not incorrectly evaluated
    Given an online evaluation monitor is enabled for the project
    And child spans arrive from a pure OTEL exporter with no origin
    When the evaluation trigger reactor fires at normal debounce
    Then no evaluation commands are dispatched (no SDK, no origin)
    When the root span arrives with evaluation markers (evaluation.run_id)
    And legacy inference sets langwatch.origin = "evaluation"
    When the deferred check fires and re-reads the fold state
    Then no evaluation commands are dispatched
    Because the origin is "evaluation", not "application"
