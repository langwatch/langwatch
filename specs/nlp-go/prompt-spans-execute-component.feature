Feature: Prompt spans on nlpgo execute_component — Studio "Open in Prompts" resumes the exact saved version with the exact variables
  When the user clicks Run on a single signature node in Studio (the execute_component path), the nlpgo engine must emit the same PromptApiService.get + Prompt.compile sibling pair the Python SDK emits, so the trace detail drawer's "Open in Prompts" deep-link resumes the operator at the same prompt, same version, same variables, and the same compiled conversation history. Without this, executing a saved prompt through nlpgo produces a trace whose LLM span has no prompt ancestry, the deep-link button is hidden, and the operator has to re-find the prompt manually — which is a behavioral regression versus python-sdk-traced applications running against the same workflow.

  Reference: python-sdk/src/langwatch/prompts/decorators/prompt_service_tracing.py + prompt_tracing.py for the canonical emission shape; langwatch/src/server/traces/findPromptReferenceInAncestors.ts for the consumer that scans sibling spans for langwatch.prompt.{id,handle,version.id,version.number,variables}; services/nlpgo/app/engine/engine.go (runSignature + buildMessages) for the emission site.

  # Bindings: services/nlpgo/tests/integration/prompt_spans_execute_component_test.go
  # (Go-side scenario binding uses /** @scenario <name> */ doc comments above each
  # test func, per the convention proven in causality_propagation_test.go.)

  Background:
    Given nlpgo is configured to export OTel spans to a span recorder
    And the Studio Run-Component path dispatches a single signature node via execute_component
    And the dispatched node carries data.configId, data.versionId, data.versionNumber forwarded from the TS PromptStudioAdapter

  Rule: When a saved prompt drives the run, two sibling spans precede the LLM span

    @integration @prompt-spans @execute-component
    Scenario: PromptApiService.get sibling carries the combined handle:version id
      Given a saved prompt with id "prompt_4RXLJtB9Cj-OA1BaLpxWc" handle "pizza-prompt" version 6 attached to a signature node
      When the engine dispatches the node via execute_component
      Then a span named "PromptApiService.get" is emitted as a sibling of the LLM span
      And the span has attribute "langwatch.prompt.id" = "pizza-prompt:6"
      And the span has attribute "langwatch.prompt.variables" matching JSON {"type":"json","value":{"prompt_id":"prompt_4RXLJtB9Cj-OA1BaLpxWc"}}
      # variables.value.prompt_id mirrors the value the dispatcher passed to .get() — the
      # raw configId from node.Data.PromptConfigID, matching prompt_spans_execute_component_test.go.
      # The combined "<handle>:<version>" form is the langwatch.prompt.id stamp, not the variables.

    @integration @prompt-spans @execute-component
    Scenario: Prompt.compile sibling carries the full prompt identity and the substituted variables
      Given a saved prompt with id "prompt_4RXLJtB9Cj-OA1BaLpxWc" handle "pizza-prompt" version_id "prompt_version_I21kDsHKtr5wQm9k1Dap2" version_number 6
      And the signature node's inputs resolve to {"foo": "bar"}
      When the engine dispatches the node via execute_component
      Then a span named "Prompt.compile" is emitted as a sibling of the LLM span
      And the span has attribute "langwatch.prompt.id" = "prompt_4RXLJtB9Cj-OA1BaLpxWc"
      And the span has attribute "langwatch.prompt.handle" = "pizza-prompt"
      And the span has attribute "langwatch.prompt.version.id" = "prompt_version_I21kDsHKtr5wQm9k1Dap2"
      And the span has attribute "langwatch.prompt.version.number" = 6
      And the span has attribute "langwatch.prompt.variables" matching JSON {"type":"json","value":{"foo":"bar"}}

    @integration @prompt-spans @execute-component
    Scenario: spans are siblings of the LLM span, not ancestors
      Given a signature node with a saved prompt attached
      When the engine dispatches the node via execute_component
      Then "PromptApiService.get" and "Prompt.compile" share the same parent span as the LLM span
      And findPromptReferenceInAncestors.ts can resolve the prompt reference from the LLM span via the sibling scan

  Rule: Missing identity is omitted rather than substituted

    @integration @prompt-spans @execute-component
    Scenario: node without a configId emits no prompt spans
      Given a signature node with no configId attached (text-in / text-out signature)
      When the engine dispatches the node via execute_component
      Then no span named "PromptApiService.get" is emitted for that dispatch
      And no span named "Prompt.compile" is emitted for that dispatch
      And the LLM span still emits as the only child of the per-node component span

    @integration @prompt-spans @execute-component
    Scenario: PromptApiService.get omits handle:version when either is missing
      Given a saved prompt that returns handle "pizza-prompt" but no version number
      When the engine dispatches a node referencing it via execute_component
      Then the "PromptApiService.get" span has no "langwatch.prompt.id" attribute
      And the "langwatch.prompt.variables" attribute still emits with the prompt_id input

  Rule: Variables capture mirrors the buildMessages template-render input map

    @integration @prompt-spans @execute-component
    Scenario: Prompt.compile variables match the inputs that drove RenderFull
      Given a saved prompt whose template references {{customer_name}} and {{topic}}
      And the signature node's resolved inputs are {"customer_name":"ACME","topic":"refunds"}
      When the engine dispatches the node via execute_component
      Then the "Prompt.compile" span attribute "langwatch.prompt.variables" matches JSON {"type":"json","value":{"customer_name":"ACME","topic":"refunds"}}

    @integration @prompt-spans @execute-component
    Scenario: Variables capture is best-effort — non-JSON-serializable values are stringified, the dispatch still succeeds
      Given a saved prompt and a signature node whose inputs include a non-serializable value at key "blob"
      When the engine dispatches the node via execute_component
      Then the "Prompt.compile" span is still emitted
      And the dispatch completes without error
      And "langwatch.prompt.variables" carries the serializable subset of inputs

  Rule: The langwatch.origin attribute is propagated verbatim from the caller hook

    @integration @prompt-spans @execute-component
    Scenario: Studio Run-Component dispatch propagates origin="workflow" to both prompt spans
      Given an execute_component dispatch from the Studio Run-Component button (useComponentExecution.ts)
      When the engine emits the prompt spans
      Then the "PromptApiService.get" span has attribute "langwatch.origin" = "workflow"
      And the "Prompt.compile" span has attribute "langwatch.origin" = "workflow"

  # Note: execute_component is dispatched by TWO callers with different origins:
  # the Studio Run-Component button (origin="workflow", covered above) and the
  # playground send via PromptStudioAdapter (origin="playground"). The latter
  # path is covered by prompt-spans-playground.feature; this file pins the
  # workflow-origin surface so the two scenarios stay independent.
