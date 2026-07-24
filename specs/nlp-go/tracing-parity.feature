Feature: Tracing parity with Python langwatch_nlp — Studio shows the same depth of input/output capture
  Operators debugging a workflow on nlpgo should see the same span tree, the same INPUT/OUTPUT capture, and the same per-block fidelity that the Python langwatch_nlp engine produced. Without this, the Studio "Full Trace" drawer regresses from "I can see what each component received and returned" to "I see one empty span called nlpgo.node.end" — which is what shipped on 2026-04-28 and triggered the rchaves callout.

  Reference: the Python target shape wraps the whole run in an `optional_langwatch_trace` span whose name reflects the endpoint type (`execute_flow` / `execute_evaluation` / `execute_component`) and `langwatch.span.type` matches (`workflow` / `evaluation` / `component`). Inside, each node with real work gets a per-node span — DSPy autotracking names that span by the generated wrapper-module class (which derives from `node.data.name` in the canvas, e.g. `Classify` for a node the operator named "Classify"). Entry/End/PromptingTechnique are pass-throughs whose generated wrappers lack `@langwatch.span` and emit no span. See langwatch_nlp/langwatch_nlp/studio/execute/execute_flow.py, execute_component.py, and python-sdk/src/langwatch/attributes.py for the reserved attribute names.

  # All scenarios are @unimplemented because the OTel span-tree parity work is
  # still incomplete in services/nlpgo/: the per-component "execute_component"
  # wrapper + per-implementation child spans (Code.forward, etc.) plus
  # langwatch.input / langwatch.output attribute capture are not yet emitted.
  # services/nlpgo/ exists; the missing pieces are the tracing instrumentation
  # itself plus parity-binding (the TS checker only scans TS test roots, so
  # Go-side OTel span parity scenarios cannot be bound via @scenario JSDoc).
  # Span recorder fixtures and assertions will live as Go integration tests
  # under services/nlpgo/. Aspirational pending tracing-instrumentation work +
  # parity-binder coverage.

  Background:
    Given nlpgo is configured to export OTel spans to a span recorder
    And a langwatch.input attribute is JSON-encoded per python-sdk attributes.py
    And a langwatch.output attribute is JSON-encoded per python-sdk attributes.py

  Rule: Each component dispatch produces a span named after the user-set node name (Python DSPy autotracking parity)

    @integration @tracing-parity @M1 @unimplemented
    Scenario: code-block per-node span uses the canvas name and span.type "component"
      Given a workflow with one code node named "Classify" returning {"output": "hi"}
      When the engine dispatches the node
      Then a span named "Classify" is emitted
      And the span has attribute "langwatch.span.type" = "component"
      And the span has attribute "langwatch.node_id" = the node id
      And the span has attribute "langwatch.node_type" = "code"
      And the span has attribute "langwatch.origin" inherited from the request

    @integration @tracing-parity @M1 @unimplemented
    Scenario: signature-block per-node span uses the canvas name
      Given a workflow with one signature node named "v1" calling gpt-5-mini
      When the engine dispatches the node
      Then a span named "v1" is emitted
      And the span has attribute "langwatch.span.type" = "component"
      And the span has attribute "langwatch.node_type" = "signature"

    @integration @tracing-parity @M1 @unimplemented
    Scenario: http-block per-node span uses the canvas name
      Given a workflow with one http node named "Fetch user" calling https://example.com
      When the engine dispatches the node
      Then a span named "Fetch user" is emitted
      And the span has attribute "langwatch.span.type" = "component"
      And the span has attribute "langwatch.node_type" = "http"

    @integration @tracing-parity @M1 @unimplemented
    Scenario: evaluator and agent_workflow nodes emit per-node spans too
      Given a workflow with an evaluator node named "Relevancy" and an agent_workflow node named "Sub"
      When the engine dispatches both
      Then a span named "Relevancy" is emitted and a span named "Sub" is emitted
      And each span has attribute "langwatch.node_type" matching the dsl ComponentKind

    @integration @tracing-parity @M1 @unimplemented
    Scenario: Entry, End, and PromptingTechnique nodes do NOT emit a per-node span
      Given a workflow with nodes [entry → code "Classify" → end]
      And a prompting_technique node hanging off the code node
      When the engine dispatches the whole workflow
      Then only one per-node span is emitted (the "Classify" span)
      And no span exists for the entry node
      And no span exists for the end node
      And no span exists for the prompting_technique node

    @integration @tracing-parity @M1 @unimplemented
    Scenario: unnamed node falls back to node.id as the span name
      Given a workflow with one code node with no canvas name and id "code-abc123"
      When the engine dispatches the node
      Then a span named "code-abc123" is emitted

  Rule: INPUT and OUTPUT are captured as JSON strings on every span (output_source = "explicit")

    @integration @tracing-parity @M2 @unimplemented
    Scenario: code block dispatch stamps langwatch.input and langwatch.output as JSON
      Given a code node that takes {"a": 2, "b": 3} and returns {"sum": 5}
      When the engine dispatches the node
      Then the per-node span has attribute "langwatch.input" set to the JSON string '{"a":2,"b":3}'
      And the same span has attribute "langwatch.output" set to the JSON string '{"sum":5}'
      And Studio renders these via the Trace Details drawer with output_source = "explicit" (not "inferred")

    @integration @tracing-parity @M2 @unimplemented
    Scenario: signature block dispatch stamps langwatch.input and langwatch.output as JSON
      Given a signature node that takes {"question": "..."} and returns {"answer": "..."}
      When the engine dispatches the node
      Then the per-node span has langwatch.input and langwatch.output set as JSON-encoded maps

    @integration @tracing-parity @M2 @unimplemented
    Scenario: huge agent outputs are preserved without truncation
      Given a code node returning a 200KB output blob
      When the engine dispatches the node
      Then the per-node span has langwatch.output set to the full 200KB JSON
      And no truncation marker appears in the attribute value
      # Python SDK default was 5000 chars/string; deliberate decision to
      # not match that on the Go path. Operators want full agent output.

    @integration @tracing-parity @M2 @unimplemented
    Scenario: error path still stamps langwatch.input but no langwatch.output
      Given a code node that raises a runtime exception
      When the engine dispatches the node
      Then the per-node span has langwatch.input set
      And the span does NOT have langwatch.output set
      And the span status is codes.Error with error.type and error.message

  Rule: Per-implementation child span names match the Python entrypoint

    @integration @tracing-parity @M3 @unimplemented
    Scenario: code block with class.__call__ entrypoint creates a child span "Code.__call__"
      Given a code node defining "class Code: def __call__(self, input): ..."
      When the engine dispatches the node
      Then the per-node span has a child span named "Code.__call__"
      And the child span carries the same trace_id and is a direct descendant

    @integration @tracing-parity @M3 @unimplemented
    Scenario: code block with class.forward entrypoint creates a child span "Code.forward"
      Given a code node defining "class Code: def forward(self, input): ..."
      When the engine dispatches the node
      Then the per-node span has a child span named "Code.forward"

    @integration @tracing-parity @M3 @unimplemented
    Scenario: code block with dspy.Module subclass creates a child span via dspy auto-instrumentation
      Given a code node defining "class Code(dspy.Module): def forward(self, input): ..."
      When the engine dispatches the node
      Then the per-node span has a child span named "Code.forward"
      And dspy.Module reference is stamped as an attribute (matches Python's "dspy.Module" output attr)

    @integration @tracing-parity @M3 @unimplemented
    Scenario: signature node creates a child span "Signature.predict" and a grandchild "gateway.chat.completions"
      Given a signature node calls openai/gpt-5-mini via the gateway
      When the dispatch completes
      Then the per-node span has a child "Signature.predict"
      And the Signature.predict span has a grandchild from the AI Gateway named "gateway.chat.completions"
      And the gateway span carries gen_ai.system, gen_ai.request.model, gen_ai.usage.input_tokens, gen_ai.usage.output_tokens

    @integration @tracing-parity @M3 @unimplemented
    Scenario: http block creates a child span "HTTP.fetch" with method + URL + status
      Given an http node that POSTs to https://api.example.com
      When the dispatch completes
      Then the per-node span has a child "HTTP.fetch"
      And the child span carries http.request.method, url.full, http.response.status_code

    @integration @tracing-parity @M3 @unimplemented
    Scenario: evaluator node creates a child span "Evaluator.run" with evaluator name
      Given an evaluator node running "ragas/answer_relevancy"
      When the dispatch completes
      Then the per-node span has a child "Evaluator.run"
      And the child span carries langwatch.evaluator.name = "ragas/answer_relevancy"
      And langwatch.evaluator.score is set to the numeric result

    @integration @tracing-parity @M3 @unimplemented
    Scenario: agent_workflow node nests sub-workflow spans under its execute_component
      Given an agent_workflow node referencing another workflow
      When the dispatch completes
      Then the outer execute_component span has children for each sub-workflow node's own execute_component span
      And the trace_id is consistent across the whole tree

  Rule: The root span name + langwatch.span.type are driven by the inbound event type

    @integration @tracing-parity @M4 @unimplemented
    Scenario Outline: root span name and type match the inbound event type
      Given an inbound event of type "<event_type>"
      When the handler opens the root span
      Then the root span name is "<expected_name>"
      And the root span has attribute "langwatch.span.type" = "<expected_type>"

      Examples:
        | event_type         | expected_name        | expected_type |
        | execute_flow       | execute_flow         | workflow      |
        | execute_evaluation | execute_evaluation   | evaluation    |
        | execute_component  | execute_component    | component     |

    @integration @tracing-parity @M4 @unimplemented
    Scenario: a multi-node flow run nests every dispatching node under the execute_flow root
      Given a flow with nodes [entry → code "Classify" → signature "Answer" → end]
      When /go/studio/execute_sync runs the whole flow
      Then a span named "execute_flow" is the root with langwatch.span.type = "workflow"
      And the per-node spans "Classify" and "Answer" are children of the root
      And no span exists for the entry or end node
      And langwatch.input on execute_flow equals the request inputs
      And langwatch.output on execute_flow equals the final node's outputs

    @integration @tracing-parity @M4 @unimplemented
    Scenario: streaming /go/studio/execute (SSE) emits the same span shape as /execute_sync
      Given the same flow as above
      When /go/studio/execute streams events
      Then the recorded span tree has the same root + children + attributes as the sync path
      And SSE event component_state_change events do NOT add extra spans (events are not spans)

  Rule: An evaluation-run wraps its many flow executions under a batch span

    @integration @tracing-parity @M5 @unimplemented
    Scenario: an evaluation experiment running 100 dataset rows produces one batch span with 100 child execute_flow spans
      Given an evaluation v3 experiment with 100 dataset rows
      When the experiment runs to completion
      Then a root span named "evaluation.batch_run" exists
      And it has 100 child spans named "execute_flow"
      And each child carries langwatch.evaluation.row_index 0..99
      And aggregate metrics (total_cost, success_count, error_count) are stamped on the batch_run span

  Rule: Origin attribution survives the new span shape

    @integration @tracing-parity @M1 @unimplemented
    Scenario: every span in the tree inherits langwatch.origin from the inbound request
      Given a workflow run with X-LangWatch-Origin: workflow
      When the run completes
      Then every span (root execute_flow, per-node spans, child impl spans, gateway spans) has attribute "langwatch.origin" = "workflow"

  # ==========================================================================
  # Test matrix authoritative list — these are the rows the Go-side integration
  # tests must cover, one Test* per row, asserting span name + attrs + parent.
  # ==========================================================================

  Rule: Test matrix — every row below has a Go integration test asserting the span shape

    @integration @tracing-parity @matrix @unimplemented
    Scenario Outline: dispatch of <node_kind> with <entrypoint_shape> produces the expected span tree
      Given a node of kind "<node_kind>" with entrypoint shape "<entrypoint_shape>"
      When the engine dispatches it
      Then the recorded span tree contains "<expected_outer_span>"
      And it contains a child span "<expected_inner_span>"
      And langwatch.input and langwatch.output are JSON-encoded on the outer span

      Examples:
        | node_kind       | entrypoint_shape          | expected_outer_span                  | expected_inner_span         |
        | code            | class.__call__            | (canvas node name)                   | Code.__call__               |
        | code            | class.forward             | (canvas node name)                   | Code.forward                |
        | code            | dspy.Module subclass      | (canvas node name)                   | Code.forward                |
        | code            | top-level execute()       | (canvas node name)                   | Code.execute                |
        | signature       | gpt-5-mini via gateway    | (canvas node name)                   | Signature.predict           |
        | http            | POST to api.example.com   | (canvas node name)                   | HTTP.fetch                  |
        | evaluator       | ragas/answer_relevancy    | (canvas node name)                   | Evaluator.run               |
        | agent_workflow  | sub-workflow ref          | (canvas node name)                   | (nested per-node span)      |
        | topic_clustering| python child path         | (no per-node span, see telemetry.feature) | gateway call           |
