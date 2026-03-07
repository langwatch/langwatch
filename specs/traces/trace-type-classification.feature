Feature: Trace scope classification
  As a LangWatch user
  I want each trace to be classified by its origin (application, evaluation, simulation, workflow, playground)
  So that I can distinguish production traces from internal/testing traces
  And online evaluations can be scoped to application traces only

  # =========================================================================
  # Design decisions
  # =========================================================================
  #
  # Canonical attribute: "langwatch.scope"
  # Values: "evaluation", "simulation", "workflow", "playground"
  #   - Absence-based: SDKs do NOT set "application" explicitly
  #   - Only special contexts (evaluation, simulation, workflow, playground)
  #     set the attribute; regular application traces leave it unset
  #   - At query time, traces without langwatch.scope are treated as "application"
  #   - This is safer: if user code wraps an experiment call, the user's root
  #     span has no opinion, so the child experiment span's "evaluation" is kept
  #
  # Hoisting: Root-span-wins-if-set semantics. The root span
  #   (parentSpanId=null) overrides any previously hoisted value, but ONLY
  #   if it explicitly sets langwatch.scope. If the root span doesn't set it,
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
  #   a) Removed from their source (SDK/platform) once langwatch.scope is set
  #   b) Used ONLY as server-side inference fallback for older clients
  #
  # 1. metadata.platform = "optimization_studio"
  #    - Set by: langwatch_nlp execute_flow.py (line 69) and
  #      execute_component.py (line 34) via langwatch.trace(metadata={...})
  #    - Used by: evaluationTrigger.reactor.ts (line 46) to skip dev traces
  #    - Hoisted as: attrs["langwatch.platform"] in trace summary
  #    - Inference: langwatch.scope = "workflow" (or "playground" if from
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
  #    - Inference: langwatch.scope = "evaluation"
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
  #    - Inference: if scope is "@langwatch/scenario", langwatch.scope = "simulation"
  #
  # 6. OTEL_RESOURCE_ATTRIBUTES with scenario.labels
  #    - Set by: scenario.processor.ts (line 323) via
  #      buildOtelResourceAttributes(scenario.labels)
  #    - Format: "scenario.labels=support,billing" as env var
  #    - These are span-level resource attributes, not trace-level markers
  #    - Inference: presence of scenario.labels → langwatch.scope = "simulation"
  #
  # 7. metadata.labels = ["scenario-runner", target.type]
  #    - Set by: scenario-child-process.ts (line ~147) via run() metadata
  #    - Hoisted as: attrs["langwatch.labels"] in trace summary
  #    - Inference: labels containing "scenario-runner" → langwatch.scope = "simulation"
  #
  # 8. evaluation.run_id / evaluation.target span attributes
  #    - Set by: Python SDK experiment.py (line 648-650) on experiment spans
  #    - Set by: TypeScript SDK experiment.ts on experiment spans
  #    - These are span-level attributes for experiment tracking
  #    - Inference: presence of evaluation.run_id → langwatch.scope = "evaluation"
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
  #     - Needs: scope field in execute payload to distinguish playground
  #

  Background:
    Given the trace processing pipeline is running
    And a project exists with id "project_abc"

  # ===========================================================================
  # Step 1a: Capturing langwatch.scope from platform-originated traces
  # ===========================================================================

  # The platform sets "langwatch.scope" in root span metadata.
  # This replaces the old metadata.platform / metadata.environment pattern.

  @unit
  Scenario: Workflow execution in production sets scope "workflow"
    Given a workflow executes with enable_tracing=true and manual_execution_mode=false
    When the trace is sent to LangWatch
    Then the root span contains attribute "langwatch.scope" = "workflow"

  @unit
  Scenario: Workflow execution in development sets scope "workflow"
    Given a workflow executes with enable_tracing=true and manual_execution_mode=true
    When the trace is sent to LangWatch
    Then the root span contains attribute "langwatch.scope" = "workflow"

  @unit
  Scenario: Component execution in studio sets scope "workflow"
    Given a studio component executes from the optimization studio canvas
    When the trace is sent to LangWatch
    Then the root span contains attribute "langwatch.scope" = "workflow"

  @unit
  Scenario: Evaluations-v3 execution sets scope "evaluation" not "workflow"
    Given an evaluation runs from the evaluations-v3 workbench
    And the evaluation orchestrator builds a workflow and dispatches to execute_flow
    When the trace is sent to LangWatch
    Then the root span contains attribute "langwatch.scope" = "evaluation"

  @unit
  Scenario: Prompt playground execution sets scope "playground"
    Given a prompt playground session executes via PromptStudioAdapter
    And PromptStudioAdapter sends an execute_component event to the studio backend
    When the trace is sent to LangWatch
    Then the root span contains attribute "langwatch.scope" = "playground"

  @unit
  Scenario: Platform scenario simulation sets scope "simulation"
    Given a scenario simulation runs from the platform via SimulationRunnerService
    When the trace is sent to LangWatch
    Then the root span contains attribute "langwatch.scope" = "simulation"

  # ===========================================================================
  # Step 1b: Capturing langwatch.scope from SDK-originated traces
  # ===========================================================================

  # SDKs set "langwatch.scope" as a span attribute on root spans.
  # This replaces the old instrumentationScope.name="langwatch-evaluation"
  # pattern and the scenario labels pattern.

  @unit
  Scenario: Python SDK experiment sets scope "evaluation"
    Given a Python SDK experiment runs with langwatch.experiment()
    When the experiment target is called and a trace is created
    Then the root span contains attribute "langwatch.scope" = "evaluation"

  @unit
  Scenario: TypeScript SDK experiment sets scope "evaluation"
    Given a TypeScript SDK experiment runs
    When the experiment target is called and a trace is created
    Then the root span contains attribute "langwatch.scope" = "evaluation"

  @unit
  Scenario: Scenario tool (Python) test run sets scope "simulation"
    Given a scenario pytest test runs via the scenario Python package
    When the test sends traces to LangWatch
    Then the root span contains attribute "langwatch.scope" = "simulation"

  @unit
  Scenario: Scenario tool (JavaScript) test run sets scope "simulation"
    Given a scenario vitest test runs via the @langwatch/scenario package
    When the test sends traces to LangWatch
    Then the root span contains attribute "langwatch.scope" = "simulation"

  @unit
  Scenario: Regular application trace does not set langwatch.scope
    Given a user application instrumented with the LangWatch Python or TypeScript SDK
    When the application sends a trace to LangWatch
    Then no "langwatch.scope" attribute is set on the spans
    And the trace is treated as "application" at query time

  @unit
  Scenario: Third-party OTEL instrumentation with no LangWatch SDK
    Given a user sends traces via a generic OTEL exporter without the LangWatch SDK
    When the trace arrives at LangWatch
    Then no "langwatch.scope" attribute is set on the spans
    And the trace is treated as "application" at query time

  # ===========================================================================
  # Step 1c: Cleanup of legacy tagging mechanisms
  # ===========================================================================

  # Once langwatch.scope is set everywhere, remove old markers from source.
  # The old metadata fields (platform, environment) are no longer set by
  # new code. The old scope names (langwatch-evaluation) are standardized.

  @unit
  Scenario: execute_flow no longer sets metadata.platform
    Given a workflow executes via execute_flow after the cleanup
    When the trace is sent to LangWatch
    Then the root span does not contain metadata key "platform"
    And the root span contains attribute "langwatch.scope" = "workflow"

  @unit
  Scenario: execute_component no longer sets metadata.platform
    Given a studio component executes after the cleanup
    When the trace is sent to LangWatch
    Then the root span does not contain metadata key "platform"
    And the root span does not contain metadata key "environment"

  @unit
  Scenario: Python SDK experiment no longer uses langwatch-evaluation scope name
    Given a Python SDK experiment runs after the cleanup
    When the experiment creates a tracer
    Then the tracer scope name is "langwatch" (same as regular traces)
    And the root span contains attribute "langwatch.scope" = "evaluation"

  @unit
  Scenario: TypeScript SDK experiment no longer uses langwatch-evaluation scope name
    Given a TypeScript SDK experiment runs after the cleanup
    When the experiment creates a tracer
    Then the tracer scope name is "langwatch" (not "langwatch-evaluation")
    And the root span contains attribute "langwatch.scope" = "evaluation"

  @unit
  Scenario: Scenario tool no longer relies on labels for scope identification
    Given a scenario test runs after the cleanup
    When the test sends traces to LangWatch
    Then the root span contains attribute "langwatch.scope" = "simulation"
    And the scope is NOT communicated via metadata.labels or scenario.labels

  # ===========================================================================
  # Step 1d: Strip legacy markers from projection on new traces
  # ===========================================================================

  # When new traces arrive with langwatch.scope set, the fold projection
  # strips exact-match legacy markers so new traces look clean immediately.
  # Only strip markers that could only be platform-specific:
  #   - metadata.platform exactly "optimization_studio"
  #   - metadata.labels containing exactly "scenario-runner"
  # Leave generic keys (environment, etc.) untouched.
  # TODO(2027): remove this stripping code once all clients are upgraded.

  @unit
  Scenario: Projection strips metadata.platform "optimization_studio" on new traces
    Given a new trace with "langwatch.scope" = "workflow"
    And metadata.platform = "optimization_studio" is set on a span
    When the fold projection processes the span
    Then the trace summary attributes contain "langwatch.scope" = "workflow"
    And the trace summary attributes do not contain "langwatch.platform"

  @unit
  Scenario: Projection strips metadata.labels "scenario-runner" on new traces
    Given a new trace with "langwatch.scope" = "simulation"
    And metadata.labels contains "scenario-runner"
    When the fold projection processes the span
    Then the trace summary attributes contain "langwatch.scope" = "simulation"
    And the trace summary attributes do not contain "scenario-runner" in labels

  @unit
  Scenario: Projection preserves user-set metadata.platform values
    Given a trace with metadata.platform = "my-custom-platform"
    When the fold projection processes the span
    Then the trace summary attributes contain "langwatch.platform" = "my-custom-platform"

  @unit
  Scenario: Projection preserves generic metadata keys like environment
    Given a new trace with "langwatch.scope" = "workflow"
    And metadata.environment = "production" is set on a span
    When the fold projection processes the span
    Then the trace summary attributes contain "langwatch.environment" = "production"

  # ===========================================================================
  # Step 2: Hoisting langwatch.scope to TraceSummaryData
  # ===========================================================================

  # The traceSummary fold projection hoists langwatch.scope with
  # root-span-wins-if-set semantics: the root span (parentSpanId=null)
  # overrides any previously hoisted value, but only if it explicitly
  # sets langwatch.scope. If the root span doesn't set it, the value
  # from child spans is preserved.

  @unit
  Scenario: Scope is hoisted from root span to trace summary
    Given a trace with root span containing "langwatch.scope" = "evaluation"
    And child spans that do not contain "langwatch.scope"
    When the fold projection processes all spans
    Then the trace summary attributes contain "langwatch.scope" = "evaluation"

  @unit
  Scenario: Root span overrides child span scope when it has an opinion
    Given a trace where a child span arrives first with "langwatch.scope" = "evaluation"
    And the root span arrives later with "langwatch.scope" = "simulation"
    When the fold projection processes all spans in arrival order
    Then the trace summary attributes contain "langwatch.scope" = "simulation"

  @unit
  Scenario: Root span without scope preserves child span scope
    Given a trace where a child span sets "langwatch.scope" = "evaluation"
    And the root span arrives later without "langwatch.scope"
    When the fold projection processes all spans in arrival order
    Then the trace summary attributes contain "langwatch.scope" = "evaluation"

  @unit
  Scenario: Traces without any scope attribute remain unset
    Given a trace where no span sets "langwatch.scope"
    When the fold projection processes all spans
    Then the trace summary attributes do not contain key "langwatch.scope"

  @unit
  Scenario: Black-box scenario trace propagates scope through traceparent
    Given a scenario simulation sends a request with traceparent header
    And the root span of the trace has "langwatch.scope" = "simulation"
    And the remote agent creates child spans under the same trace
    When the fold projection processes all spans
    Then the trace summary attributes contain "langwatch.scope" = "simulation"

  # ===========================================================================
  # Step 3: Server-side inference for legacy traces (backwards compatibility)
  # ===========================================================================

  # For traces from older SDKs/platform versions that don't set
  # langwatch.scope, the fold projection infers it from legacy markers.
  # Inference priority (highest to lowest):
  #   1. Explicit langwatch.scope attribute (always wins)
  #   2. instrumentationScope.name = "langwatch-evaluation" → "evaluation"
  #   3. instrumentationScope.name = "@langwatch/scenario" → "simulation"
  #   4. metadata.platform = "optimization_studio" → "workflow"
  #   5. metadata.labels contains "scenario-runner" → "simulation"
  #   6. resource attribute scenario.labels present → "simulation"
  #   7. span attribute evaluation.run_id present → "evaluation"
  #   8. No signal → unset (treated as "application" at query time)

  @unit
  Scenario: Infer scope from instrumentationScope.name "langwatch-evaluation"
    Given a trace from an older Python SDK that does not set "langwatch.scope"
    And the root span has instrumentationScope.name = "langwatch-evaluation"
    When the fold projection processes the span
    Then the trace summary attributes contain "langwatch.scope" = "evaluation"

  @unit
  Scenario: Infer scope from instrumentationScope.name "@langwatch/scenario"
    Given a trace from an older scenario tool that does not set "langwatch.scope"
    And spans have instrumentationScope.name = "@langwatch/scenario"
    When the fold projection processes the spans
    Then the trace summary attributes contain "langwatch.scope" = "simulation"

  @unit
  Scenario: Infer scope from metadata.platform "optimization_studio"
    Given a trace from an older platform version
    And metadata.platform = "optimization_studio" is set
    And no "langwatch.scope" attribute is present
    When the fold projection processes the span
    Then the trace summary attributes contain "langwatch.scope" = "workflow"

  @unit
  Scenario: Infer scope from metadata.labels containing "scenario-runner"
    Given a trace from an older platform scenario execution
    And metadata.labels contains "scenario-runner"
    And no "langwatch.scope" attribute is present
    When the fold projection processes the span
    Then the trace summary attributes contain "langwatch.scope" = "simulation"

  @unit
  Scenario: Infer scope from resource attribute scenario.labels
    Given a trace from an older scenario tool
    And resource attributes contain "scenario.labels"
    And no "langwatch.scope" attribute is present
    When the fold projection processes the span
    Then the trace summary attributes contain "langwatch.scope" = "simulation"

  @unit
  Scenario: Infer scope from span attribute evaluation.run_id
    Given a trace from an older SDK experiment
    And a span contains attribute "evaluation.run_id"
    And no "langwatch.scope" attribute is present
    When the fold projection processes the span
    Then the trace summary attributes contain "langwatch.scope" = "evaluation"

  @unit
  Scenario: Explicit langwatch.scope takes precedence over all inferred signals
    Given a trace where the root span sets "langwatch.scope" = "evaluation"
    And metadata.platform = "optimization_studio" is also set
    And instrumentationScope.name = "langwatch-evaluation" is also set
    When the fold projection processes the span
    Then the trace summary attributes contain "langwatch.scope" = "evaluation"

  # ===========================================================================
  # Step 4: ClickHouse storage
  # ===========================================================================

  @integration
  Scenario: Scope is persisted in ClickHouse trace_summaries
    Given a trace with "langwatch.scope" = "evaluation"
    When the trace summary is stored in ClickHouse
    Then querying trace_summaries returns Attributes containing "langwatch.scope" = "evaluation"

  # ===========================================================================
  # Step 5 (future): Trace list quick filters
  # ===========================================================================

  @e2e
  Scenario: User filters traces by scope using quick filter chips
    Given I am on the traces list page
    And there are traces with scope "application", "evaluation", and "simulation"
    When I click the "Application" quick filter chip
    Then only traces with "langwatch.scope" = "application" or without the attribute are shown
    And the "Application" chip appears selected

  @e2e
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
  # This is replaced by a single check on langwatch.scope.

  @unit
  Scenario: Online evaluations skip evaluation traces
    Given an online evaluation monitor is enabled for the project
    And a trace arrives with "langwatch.scope" = "evaluation"
    When the evaluation trigger reactor processes the trace
    Then no evaluation is triggered for this trace

  @unit
  Scenario: Online evaluations run on application traces
    Given an online evaluation monitor is enabled for the project
    And a trace arrives without "langwatch.scope" set
    When the evaluation trigger reactor processes the trace
    Then evaluations are triggered normally

  @unit
  Scenario: Online evaluations skip simulation traces
    Given an online evaluation monitor is enabled for the project
    And a trace arrives with "langwatch.scope" = "simulation"
    When the evaluation trigger reactor processes the trace
    Then no evaluation is triggered for this trace

  @unit
  Scenario: Online evaluations skip workflow traces
    Given an online evaluation monitor is enabled for the project
    And a trace arrives with "langwatch.scope" = "workflow"
    When the evaluation trigger reactor processes the trace
    Then no evaluation is triggered for this trace

  @unit
  Scenario: Online evaluations skip playground traces
    Given an online evaluation monitor is enabled for the project
    And a trace arrives with "langwatch.scope" = "playground"
    When the evaluation trigger reactor processes the trace
    Then no evaluation is triggered for this trace
