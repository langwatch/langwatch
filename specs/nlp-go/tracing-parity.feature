Feature: Tracing parity with Python langwatch_nlp — Studio shows the same depth of input/output capture
  Operators debugging a workflow on nlpgo should see the same span tree, the same INPUT/OUTPUT capture, and the same per-block fidelity that the Python langwatch_nlp engine produced. Without this, the Studio "Full Trace" drawer regresses from "I can see what each component received and returned" to "I see one empty span called nlpgo.node.end" — which is what shipped on 2026-04-28 and triggered the rchaves callout.

  Reference: the Python target shape uses optional_langwatch_trace(name="execute_component", type="component") wrapping each component dispatch, plus dspy auto-instrumentation for the per-implementation child span (e.g. `Code.forward`, `Code.__call__`). See langwatch_nlp/langwatch_nlp/studio/execute/execute_component.py and python-sdk/src/langwatch/attributes.py for the reserved attribute names.

  Background:
    Given nlpgo is configured to export OTel spans to a span recorder
    And a langwatch.input attribute is JSON-encoded per python-sdk attributes.py
    And a langwatch.output attribute is JSON-encoded per python-sdk attributes.py

  Rule: Each component dispatch produces a span named "execute_component" matching Python

    @integration @tracing-parity @M1 @unimplemented
    Scenario: code-block execute_component span has the same name and span.type as Python
      Given a workflow with one code node returning {"output": "hi"}
      When the engine dispatches the node
      Then a span named "execute_component" is emitted
      And the span has attribute "langwatch.span.type" = "component"
      And the span has attribute "langwatch.node_id" = the node id
      And the span has attribute "langwatch.node_type" = "code"
      And the span has attribute "langwatch.origin" inherited from the request

    @integration @tracing-parity @M1 @unimplemented
    Scenario: signature-block execute_component span has the same shape
      Given a workflow with one signature node calling gpt-5-mini
      When the engine dispatches the node
      Then a span named "execute_component" is emitted
      And the span has attribute "langwatch.span.type" = "component"
      And the span has attribute "langwatch.node_type" = "signature"

    @integration @tracing-parity @M1 @unimplemented
    Scenario: http-block execute_component span has the same shape
      Given a workflow with one http node calling https://example.com
      When the engine dispatches the node
      Then a span named "execute_component" is emitted
      And the span has attribute "langwatch.span.type" = "component"
      And the span has attribute "langwatch.node_type" = "http"

    @integration @tracing-parity @M1 @unimplemented
    Scenario: evaluator and agent_workflow nodes emit execute_component spans too
      Given a workflow with an evaluator node and an agent_workflow node
      When the engine dispatches both
      Then both nodes emit a span named "execute_component"
      And each span has attribute "langwatch.node_type" matching the dsl ComponentKind

  Rule: INPUT and OUTPUT are captured as JSON strings on every span (output_source = "explicit")

    @integration @tracing-parity @M2 @unimplemented
    Scenario: code block dispatch stamps langwatch.input and langwatch.output as JSON
      Given a code node that takes {"a": 2, "b": 3} and returns {"sum": 5}
      When the engine dispatches the node
      Then the execute_component span has attribute "langwatch.input" set to the JSON string '{"a":2,"b":3}'
      And the same span has attribute "langwatch.output" set to the JSON string '{"sum":5}'
      And Studio renders these via the Trace Details drawer with output_source = "explicit" (not "inferred")

    @integration @tracing-parity @M2 @unimplemented
    Scenario: signature block dispatch stamps langwatch.input and langwatch.output as JSON
      Given a signature node that takes {"question": "..."} and returns {"answer": "..."}
      When the engine dispatches the node
      Then the execute_component span has langwatch.input and langwatch.output set as JSON-encoded maps

    @integration @tracing-parity @M2 @unimplemented
    Scenario: huge agent outputs are preserved without truncation
      Given a code node returning a 200KB output blob
      When the engine dispatches the node
      Then the execute_component span has langwatch.output set to the full 200KB JSON
      And no truncation marker appears in the attribute value
      # Python SDK default was 5000 chars/string; deliberate decision to
      # not match that on the Go path. Operators want full agent output.

    @integration @tracing-parity @M2 @unimplemented
    Scenario: error path still stamps langwatch.input but no langwatch.output
      Given a code node that raises a runtime exception
      When the engine dispatches the node
      Then the execute_component span has langwatch.input set
      And the span does NOT have langwatch.output set
      And the span status is codes.Error with error.type and error.message

  Rule: Per-implementation child span names match the Python entrypoint

    @integration @tracing-parity @M3 @unimplemented
    Scenario: code block with class.__call__ entrypoint creates a child span "Code.__call__"
      Given a code node defining "class Code: def __call__(self, input): ..."
      When the engine dispatches the node
      Then the execute_component span has a child span named "Code.__call__"
      And the child span carries the same trace_id and is a direct descendant

    @integration @tracing-parity @M3 @unimplemented
    Scenario: code block with class.forward entrypoint creates a child span "Code.forward"
      Given a code node defining "class Code: def forward(self, input): ..."
      When the engine dispatches the node
      Then the execute_component span has a child span named "Code.forward"

    @integration @tracing-parity @M3 @unimplemented
    Scenario: code block with dspy.Module subclass creates a child span via dspy auto-instrumentation
      Given a code node defining "class Code(dspy.Module): def forward(self, input): ..."
      When the engine dispatches the node
      Then the execute_component span has a child span named "Code.forward"
      And dspy.Module reference is stamped as an attribute (matches Python's "dspy.Module" output attr)

    @integration @tracing-parity @M3 @unimplemented
    Scenario: signature node creates a child span "Signature.predict" and a grandchild "gateway.chat.completions"
      Given a signature node calls openai/gpt-5-mini via the gateway
      When the dispatch completes
      Then the execute_component span has a child "Signature.predict"
      And the Signature.predict span has a grandchild from the AI Gateway named "gateway.chat.completions"
      And the gateway span carries gen_ai.system, gen_ai.request.model, gen_ai.usage.input_tokens, gen_ai.usage.output_tokens

    @integration @tracing-parity @M3 @unimplemented
    Scenario: http block creates a child span "HTTP.fetch" with method + URL + status
      Given an http node that POSTs to https://api.example.com
      When the dispatch completes
      Then the execute_component span has a child "HTTP.fetch"
      And the child span carries http.request.method, url.full, http.response.status_code

    @integration @tracing-parity @M3 @unimplemented
    Scenario: evaluator node creates a child span "Evaluator.run" with evaluator name
      Given an evaluator node running "ragas/answer_relevancy"
      When the dispatch completes
      Then the execute_component span has a child "Evaluator.run"
      And the child span carries langwatch.evaluator.name = "ragas/answer_relevancy"
      And langwatch.evaluator.score is set to the numeric result

    @integration @tracing-parity @M3 @unimplemented
    Scenario: agent_workflow node nests sub-workflow spans under its execute_component
      Given an agent_workflow node referencing another workflow
      When the dispatch completes
      Then the outer execute_component span has children for each sub-workflow node's own execute_component span
      And the trace_id is consistent across the whole tree

  Rule: Whole-flow execute carries an outer "execute_flow" span wrapping every execute_component

    @integration @tracing-parity @M4 @unimplemented
    Scenario: a multi-node flow run nests every component under one execute_flow span
      Given a flow with nodes [entry → code → signature → end]
      When /go/studio/execute_sync runs the whole flow
      Then a span named "execute_flow" is the root
      And each non-entry/non-end node has its own "execute_component" span as a child of "execute_flow"
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
      Then every span (root, execute_flow, execute_component, child impl spans, gateway spans) has attribute "langwatch.origin" = "workflow"

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
        | node_kind       | entrypoint_shape          | expected_outer_span | expected_inner_span         |
        | code            | class.__call__            | execute_component   | Code.__call__               |
        | code            | class.forward             | execute_component   | Code.forward                |
        | code            | dspy.Module subclass      | execute_component   | Code.forward                |
        | code            | top-level execute()       | execute_component   | Code.execute                |
        | signature       | gpt-5-mini via gateway    | execute_component   | Signature.predict           |
        | http            | POST to api.example.com   | execute_component   | HTTP.fetch                  |
        | evaluator       | ragas/answer_relevancy    | execute_component   | Evaluator.run               |
        | agent_workflow  | sub-workflow ref          | execute_component   | (nested execute_component)  |
        | topic_clustering| python child path         | (no execute_component, see telemetry.feature) | gateway call |
