Feature: Prompt spans on nlpgo execute_workflow — every signature node in a multi-node workflow emits its own prompt-ancestry pair
  When a workflow with multiple signature nodes runs via execute_flow, each signature node's LLM span must have its own PromptApiService.get + Prompt.compile siblings — bound to that node's configId/versionId, that node's resolved variables, and emitted under that node's per-component span. Without per-node emission, the trace drawer "Open in Prompts" deep-link from one signature node's LLM span resolves to whichever sibling happened to be nearest, leaking another node's prompt identity into the wrong drawer.

  Reference: services/nlpgo/app/engine/engine.go (the per-node dispatch loop in runSignature) and the tracing wrapper in app/engine/tracing.go. The TS-side consumer (findPromptReferenceInAncestors.ts) walks sibling-then-ancestor for a prompt reference; both axes need to be unambiguous when multiple signature nodes coexist in one trace.

  # Bindings: services/nlpgo/tests/integration/prompt_spans_execute_workflow_test.go
  # (Go-side scenario binding uses /** @scenario <name> */ doc comments above each
  # test func, per the convention proven in causality_propagation_test.go.)

  Background:
    Given nlpgo is configured to export OTel spans to a span recorder
    And the engine dispatches the full DAG via execute_flow (req.NodeID empty)

  Rule: Each signature node owns its own PromptApiService.get + Prompt.compile pair

    @integration @prompt-spans @execute-workflow
    Scenario: two signature nodes in series emit two distinct sibling pairs
      Given signature node "Classify" referencing prompt "classifier:3" with inputs {"text":"hi"}
      And signature node "Respond" referencing prompt "responder:7" with inputs {"label":"greet"}
      And an edge "Classify".label → "Respond".label
      When the engine dispatches the workflow via execute_flow
      Then two "PromptApiService.get" spans are emitted, one under each per-component span
      And two "Prompt.compile" spans are emitted, one under each per-component span
      And the "Classify" subtree has spans with "langwatch.prompt.id" = "classifier:3"
      And the "Respond" subtree has spans with "langwatch.prompt.id" = "responder:7"

    @integration @prompt-spans @execute-workflow
    Scenario: variables capture reflects each node's resolved inputs, not the workflow's
      Given signature node "A" with inputs {"x":1} and signature node "B" with inputs {"y":2}
      When the engine dispatches the workflow via execute_flow
      Then "Prompt.compile" under the "A" subtree has variables {"type":"json","value":{"x":1}}
      And "Prompt.compile" under the "B" subtree has variables {"type":"json","value":{"y":2}}
      And neither span's variables contain the other node's inputs

  Rule: Mixed prompted + unprompted nodes emit prompt spans only for the prompted ones

    @integration @prompt-spans @execute-workflow
    Scenario: signature node with no configId coexists with a prompted node
      Given signature node "Free" with no configId (raw instructions parameter)
      And signature node "Saved" with configId "saved-prompt:2"
      When the engine dispatches the workflow via execute_flow
      Then no prompt spans are emitted under the "Free" subtree
      And both prompt spans ARE emitted under the "Saved" subtree
      And findPromptReferenceInAncestors.ts resolves a reference only for the LLM span under "Saved"

  Rule: Parent-of-prompt-spans is the per-node component span, not the workflow root

    @integration @prompt-spans @execute-workflow
    Scenario: prompt spans live under the per-node span so the ancestor scan stays scoped
      Given a signature node "Q" with a saved prompt attached
      When the engine dispatches the workflow via execute_flow
      Then both prompt spans have the "Q" per-node span as their parent
      And the workflow root span has no direct prompt-span children
      And a sibling node's LLM span cannot resolve "Q"'s prompt reference via the ancestor walk

  Rule: origin is "workflow" on every prompt span emitted by this path

    @integration @prompt-spans @execute-workflow
    Scenario: origin propagation matches the dispatch endpoint
      Given an execute_flow dispatch
      When the engine emits per-node prompt spans
      Then every "PromptApiService.get" span has attribute "langwatch.origin" = "workflow"
      And every "Prompt.compile" span has attribute "langwatch.origin" = "workflow"

  Rule: Repeated dispatches of the same node emit distinct span pairs (no reuse)

    @integration @prompt-spans @execute-workflow
    Scenario: a node dispatched twice in one run emits two prompt-span pairs
      Given a workflow that loops over a signature node "L" twice
      When the engine dispatches the workflow via execute_flow
      Then two "PromptApiService.get" spans and two "Prompt.compile" spans exist under "L"'s subtree
      And each pair is sibling to a distinct LLM span
