Feature: Trace origin classification
  As a LangWatch user
  I want each trace to be classified by its origin (application, evaluation, simulation, workflow, playground)
  So that I can distinguish production traces from internal/testing traces
  And online evaluations can be scoped to application traces only

  # =========================================================================
  # Design decisions
  # =========================================================================
  #
  # Canonical attribute: "langwatch.origin"
  # Values: "application", "evaluation", "simulation", "workflow", "playground"
  #   - Explicit: SDKs set "application" on root spans for regular traces
  #   - Special contexts (evaluation, simulation, workflow, playground)
  #     set their respective value on the root span
  #   - Empty/absent origin means "pending" (not yet determined), NOT "application"
  #   - This was changed from an absence-based design because of a race condition:
  #     when child spans arrive before the root span (which carries the origin),
  #     the trace has no origin for up to a minute. The evaluation trigger reactor
  #     fires after 30s and the precondition matcher was defaulting empty to
  #     "application", causing evaluations to incorrectly fire on evaluation and
  #     simulation traces.
  #   - Root-span-wins-if-set semantics still apply for hoisting.
  #
  # Hoisting: Root-span-wins-if-set semantics. The root span
  #   (parentSpanId=null) overrides any previously hoisted value, but ONLY
  #   if it explicitly sets langwatch.origin. If the root span doesn't set it,
  #   the value hoisted from child spans is preserved.
  #
  # This attribute replaces and unifies ALL prior ad-hoc scope/tagging
  # mechanisms. See "Legacy tagging mechanisms" section below for the
  # complete inventory of what is being replaced and cleaned up.
  #
  # =========================================================================
  # Legacy tagging mechanisms (to be cleaned up + used for inference)
  # =========================================================================
  #
  # The following scattered mechanisms currently exist across the codebase.
  # ALL of these will be:
  #   a) Removed from their source (SDK/platform) once langwatch.origin is set
  #   b) Used ONLY as server-side inference fallback for older clients
  #
  # 1. metadata.platform = "optimization_studio"
  #    - Set by: langwatch_nlp execute_flow.py (line 69) and
  #      execute_component.py (line 34) via langwatch.trace(metadata={...})
  #    - Used by: evaluationTrigger.reactor.ts (line 46) to skip dev traces
  #    - Hoisted as: attrs["langwatch.platform"] in trace summary
  #    - Inference: langwatch.origin = "workflow" (or "playground" if from
  #      PromptStudioAdapter, or "evaluation" if from evaluations-v3)
  #
  # 2. metadata.environment = "development" | "production"
  #    - Set by: execute_flow.py (line 70) and execute_component.py (line 35)
  #    - Used by: evaluationTrigger.reactor.ts (line 47) combined with #1
  #    - Hoisted as: attrs["langwatch.environment"] in trace summary
  #    - Inference: combined with #1 to distinguish dev vs prod workflows
  #
  # 3. instrumentationScope.name = "langwatch-evaluation"
  #    - Set by: Python SDK experiment.py (line 639, 798) via
  #      trace.get_tracer("langwatch-evaluation")
  #    - Set by: TypeScript SDK experiment.ts (line 229, 640) via
  #      trace.getTracer("langwatch-evaluation")
  #    - Stored in: stored_spans.ScopeName in ClickHouse
  #    - Inference: langwatch.origin = "evaluation"
  #
  # 4. instrumentationScope.name = "langwatch"
  #    - Set by: Python SDK tracing.py (line 131-133) via
  #      trace_api.get_tracer("langwatch", __version__)
  #    - Set by: Python SDK span.py (line 205) as fallback
  #    - This is the default scope for all Python SDK traces
  #    - Inference: no signal (ambiguous — used for both app and experiments)
  #
  # 5. scenario_only / with_custom_scopes span filters
  #    - Set by: Scenario tool _tracing/filters.py — filters spans by
  #      instrumentationScope.name == "langwatch"
  #    - Set by: Scenario tool JavaScript filters.ts — filters by
  #      scope "@langwatch/scenario"
  #    - These are CLIENT-SIDE span export filters, not trace-level markers
  #    - Inference: if scope is "@langwatch/scenario", langwatch.origin = "simulation"
  #
  # 6. OTEL_RESOURCE_ATTRIBUTES with scenario.labels
  #    - Set by: scenario.processor.ts (line 323) via
  #      buildOtelResourceAttributes(scenario.labels)
  #    - Format: "scenario.labels=support,billing" as env var
  #    - These are span-level resource attributes, not trace-level markers
  #    - Inference: presence of scenario.labels → langwatch.origin = "simulation"
  #
  # 7. metadata.labels = ["scenario-runner", target.type]
  #    - Set by: scenario-child-process.ts (line ~147) via run() metadata
  #    - Hoisted as: attrs["langwatch.labels"] in trace summary
  #    - Inference: labels containing "scenario-runner" → langwatch.origin = "simulation"
  #
  # 8. evaluation.run_id / evaluation.target span attributes
  #    - Set by: Python SDK experiment.py (line 648-650) on experiment spans
  #    - Set by: TypeScript SDK experiment.ts on experiment spans
  #    - These are span-level attributes for experiment tracking
  #    - Inference: presence of evaluation.run_id → langwatch.origin = "evaluation"
  #
  # 9. do_not_trace = True
  #    - Set by: execute_evaluation.py (line 56), execute_optimization.py
  #      (line 68), dspy/custom_node.py (line 31)
  #    - Effect: traces are NOT sent at all (disable_sending=True)
  #    - No inference needed — these traces never arrive
  #
  # 10. PromptStudioAdapter (prompt playground)
  #     - File: service-adapter.ts — sends execute_component events
  #     - Currently indistinguishable from studio component execution
  #     - Both set metadata.platform="optimization_studio",
  #       metadata.environment="development"
  #     - Needs: origin field in execute payload to distinguish playground
  #

  Background:
    Given the trace processing pipeline is running
    And a project exists with id "project_abc"

  # ===========================================================================
  # Step 1a: Capturing langwatch.origin from platform-originated traces
  # ===========================================================================

  # The platform sets "langwatch.origin" in root span metadata.
  # This replaces the old metadata.platform / metadata.environment pattern.

  @unit @unimplemented
  Scenario: Workflow execution in production sets origin "workflow"
    Given a workflow executes with enable_tracing=true and manual_execution_mode=false
    When the trace is sent to LangWatch
    Then the root span contains attribute "langwatch.origin" = "workflow"

  @unit @unimplemented
  Scenario: Workflow execution in development sets origin "workflow"
    Given a workflow executes with enable_tracing=true and manual_execution_mode=true
    When the trace is sent to LangWatch
    Then the root span contains attribute "langwatch.origin" = "workflow"

  @unit @unimplemented
  Scenario: Component execution in studio sets origin "workflow"
    Given a studio component executes from the optimization studio canvas
    When the trace is sent to LangWatch
    Then the root span contains attribute "langwatch.origin" = "workflow"

  @unit @unimplemented
  Scenario: Evaluations-v3 execution sets origin "evaluation" not "workflow"
    Given an evaluation runs from the evaluations-v3 workbench
    And the evaluation orchestrator builds a workflow and dispatches to execute_flow
    When the trace is sent to LangWatch
    Then the root span contains attribute "langwatch.origin" = "evaluation"

  @unit @unimplemented
  Scenario: Prompt playground execution sets origin "playground"
    Given a prompt playground session executes via PromptStudioAdapter
    And PromptStudioAdapter sends an execute_component event to the studio backend
    When the trace is sent to LangWatch
    Then the root span contains attribute "langwatch.origin" = "playground"

  @unit @unimplemented
  Scenario: Platform scenario simulation sets origin "simulation"
    Given a scenario simulation runs from the platform via SimulationRunnerService
    When the trace is sent to LangWatch
    Then the root span contains attribute "langwatch.origin" = "simulation"

  # ===========================================================================
  # Step 1b: Capturing langwatch.origin from SDK-originated traces
  # ===========================================================================

  # SDKs set "langwatch.origin" as a span attribute on root spans.
  # This replaces the old instrumentationScope.name="langwatch-evaluation"
  # pattern and the scenario labels pattern.

  @unit @unimplemented
  Scenario: Python SDK experiment sets origin "evaluation"
    Given a Python SDK experiment runs with langwatch.experiment()
    When the experiment target is called and a trace is created
    Then the root span contains attribute "langwatch.origin" = "evaluation"

  @unit @unimplemented
  Scenario: Scenario tool (Python) test run sets origin "simulation"
    Given a scenario pytest test runs via the scenario Python package
    When the test sends traces to LangWatch
    Then the root span contains attribute "langwatch.origin" = "simulation"

  @unit @unimplemented
  Scenario: Scenario tool (JavaScript) test run sets origin "simulation"
    Given a scenario vitest test runs via the @langwatch/scenario package
    When the test sends traces to LangWatch
    Then the root span contains attribute "langwatch.origin" = "simulation"

  # ===========================================================================
  # Step 1c: Cleanup of legacy tagging mechanisms
  # ===========================================================================

  # Once langwatch.origin is set everywhere, remove old markers from source.
  # The old metadata fields (platform, environment) are no longer set by
  # new code. The old origin names (langwatch-evaluation) are standardized.

  # ===========================================================================
  # Step 1d: Strip legacy markers from projection on new traces
  # ===========================================================================

  # When new traces arrive with langwatch.origin set, the fold projection
  # strips exact-match legacy markers so new traces look clean immediately.
  # Only strip markers that could only be platform-specific:
  #   - metadata.platform exactly "optimization_studio"
  #   - metadata.labels containing exactly "scenario-runner"
  # Leave generic keys (environment, etc.) untouched.
  # TODO(2027): remove this stripping code once all clients are upgraded.

  # ===========================================================================
  # Step 2: Hoisting langwatch.origin to TraceSummaryData
  # ===========================================================================

  # The traceSummary fold projection hoists langwatch.origin with
  # root-span-wins-if-set semantics: the root span (parentSpanId=null)
  # overrides any previously hoisted value, but only if it explicitly
  # sets langwatch.origin. If the root span doesn't set it, the value
  # from child spans is preserved.

  # ===========================================================================
  # Step 3: Server-side inference for legacy traces (backwards compatibility)
  # ===========================================================================

  # For traces from older SDKs/platform versions that don't set
  # langwatch.origin, the fold projection infers it from legacy markers.
  # Inference priority (highest to lowest):
  #   1. Explicit langwatch.origin attribute (always wins)
  #   2. instrumentationScope.name = "langwatch-evaluation" → "evaluation"
  #   3. instrumentationScope.name = "@langwatch/scenario" → "simulation"
  #   4. metadata.platform = "optimization_studio" → "workflow"
  #   5. metadata.labels contains "scenario-runner" → "simulation"
  #   6. resource attribute scenario.labels present → "simulation"
  #   7. span attribute evaluation.run_id present → "evaluation"
  #   8. No signal → unset (treated as "application" at query time)

  # ===========================================================================
  # Step 4: ClickHouse storage
  # ===========================================================================

  @integration @unimplemented
  Scenario: Origin is persisted in ClickHouse trace_summaries
    Given a trace with "langwatch.origin" = "evaluation"
    When the trace summary is stored in ClickHouse
    Then querying trace_summaries returns Attributes containing "langwatch.origin" = "evaluation"

  # ===========================================================================
  # Step 5 (future): Trace list quick filters
  # ===========================================================================

  @e2e @unimplemented
  Scenario: User filters traces by origin using quick filter chips
    Given I am on the traces list page
    And there are traces with origin "application", "evaluation", and "simulation"
    When I click the "Application" quick filter chip
    Then only traces with "langwatch.origin" = "application" or without the attribute are shown
    And the "Application" chip appears selected

  @e2e @unimplemented
  Scenario: "All traces" quick filter shows everything
    Given I am on the traces list page
    And the "Application" quick filter is currently active
    When I click the "All traces" quick filter chip
    Then all traces are shown regardless of scope

  # ===========================================================================
  # Step 6 (future): Online evaluation pre-filtering
  # ===========================================================================

  # The evaluationTrigger reactor currently checks:
  #   attrs["langwatch.platform"] === "optimization_studio" &&
  #   attrs["langwatch.environment"] === "development"
  # This is replaced by a single check on langwatch.origin.

  @unit @unimplemented
  Scenario: Online evaluations skip evaluation traces
    Given an online evaluation monitor is enabled for the project
    And a trace arrives with "langwatch.origin" = "evaluation"
    When the evaluation trigger reactor processes the trace
    Then no evaluation is triggered for this trace

  @unit @unimplemented
  Scenario: Online evaluations skip simulation traces
    Given an online evaluation monitor is enabled for the project
    And a trace arrives with "langwatch.origin" = "simulation"
    When the evaluation trigger reactor processes the trace
    Then no evaluation is triggered for this trace

  @unit @unimplemented
  Scenario: Online evaluations skip workflow traces
    Given an online evaluation monitor is enabled for the project
    And a trace arrives with "langwatch.origin" = "workflow"
    When the evaluation trigger reactor processes the trace
    Then no evaluation is triggered for this trace

  @unit @unimplemented
  Scenario: Online evaluations skip playground traces
    Given an online evaluation monitor is enabled for the project
    And a trace arrives with "langwatch.origin" = "playground"
    When the evaluation trigger reactor processes the trace
    Then no evaluation is triggered for this trace
