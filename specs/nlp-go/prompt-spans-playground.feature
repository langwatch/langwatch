Feature: Prompt spans on the playground — trace→playground resume parity with the Python SDK
  As a user running prompts in the Studio playground on a Go-NLP project
  I want every playground send to emit the same PromptApiService.get + Prompt.compile span pair
    that langwatch python-sdk emits when an app calls prompt.get() and prompt.compile()
  So that opening the trace later shows the exact handle, version, and variables
    and I can click "Open in Prompts" to resume the conversation byte-equivalent to where I left it

  # Wire-format reference (locked, do not drift):
  #   python-sdk/src/langwatch/prompts/decorators/prompt_service_tracing.py
  #   python-sdk/src/langwatch/prompts/decorators/prompt_tracing.py
  #   python-sdk/src/langwatch/attributes.py (LangWatchPrompt* keys)
  # Trace-UI consumers that depend on this shape:
  #   langwatch/src/features/traces-v2/utils/promptAttributes.ts
  #   langwatch/src/features/traces-v2/components/TraceDrawer/PromptAccordion.tsx
  #   langwatch/src/features/traces-v2/utils/findPromptReferenceInAncestors.ts
  #
  # Bindings:
  #   - Emission scenarios (1, 3, 4, 5, 6): services/nlpgo/tests/integration/prompt_spans_playground_test.go
  #   - Drawer / Open-in-Prompts scenario (2): langwatch/src/features/traces-v2/.../PromptAccordion.integration.test.ts

  Background:
    Given the nlpgo service is running and the project is on the Go-NLP execution path
    And a saved prompt exists with config id "prompt_supportrouter_xyz", handle "support-router", and saved version 6 (version id "prompt_version_supportrouter_v6")
    And the Studio playground is open on that prompt

  # ============================================================================
  # Identity contract (locked, matches python-sdk + integration tests)
  # ============================================================================
  #   PromptApiService.get span:
  #     langwatch.prompt.variables = {"type":"json","value":{"prompt_id":"<configId>"}}
  #     langwatch.prompt.id        = "<handle>:<versionNumber>"   (combined, only when both resolved)
  #   Prompt.compile span:
  #     langwatch.prompt.id             = "<configId>"            (RAW, not the combined form)
  #     langwatch.prompt.handle         = "<handle>"
  #     langwatch.prompt.version.id     = "<versionId>"
  #     langwatch.prompt.version.number = <versionNumber>
  #     langwatch.prompt.variables      = {"type":"json","value":{...userKwargs...}}
  # The combined "<handle>:<version>" form lives ONLY on PromptApiService.get
  # (python prompt_service_tracing.py:53-57). Prompt.compile carries the raw
  # configId per python prompt_tracing.py:30 (`getattr(prompt, "id", None)`).

  # ============================================================================
  # Saved-version path — the default trace→playground resume target
  # ============================================================================

  @integration @v1
  Scenario: playground send on a saved prompt version emits a get+compile span pair
    When I send "how do I refund?" through the playground chat
    Then the trace contains a span named "PromptApiService.get"
    And that get span has attribute "langwatch.prompt.variables" set to a JSON string of shape
      """
      {"type":"json","value":{"prompt_id":"prompt_supportrouter_xyz"}}
      """
    And the get span has attribute "langwatch.prompt.id" equal to "support-router:6"
    And the trace contains a span named "Prompt.compile" emitted after the get span
    And the compile span has attribute "langwatch.prompt.id" equal to "prompt_supportrouter_xyz"
    And the compile span has attribute "langwatch.prompt.handle" equal to "support-router"
    And the compile span has attribute "langwatch.prompt.version.id" equal to "prompt_version_supportrouter_v6"
    And the compile span has attribute "langwatch.prompt.version.number" equal to 6
    And the compile span has attribute "langwatch.prompt.variables" containing every declared template variable populated with the values used for this send
    # Live chat content goes to the LLM-span messages, not to compile vars; see scenario 4 for declared-variable fidelity.
    And "PromptApiService.get", "Prompt.compile", and the LLM span are three siblings under the same parent (the per-event-type root span for playground)

  @integration @v1
  Scenario: trace drawer surfaces "Open in Prompts" with the exact handle and version
    Given I have sent a chat message that produced the saved-version span pair
    When I open the trace details drawer for the resulting LLM span
    Then the "Open in Prompts" menu shows "Open support-router:6"
    And clicking it opens the playground pre-loaded with version 6 of "support-router"
    And the Variables panel is pre-filled with the same values captured on the compile span

  # ============================================================================
  # Ad-hoc / "Create new prompt" path — no saved base
  # ============================================================================

  @integration @v1
  Scenario: playground send on an unsaved fresh prompt emits compile but no get
    Given the user opened a fresh playground without selecting any saved prompt
    When I send "what time is it?" through the playground chat
    Then the trace contains NO span named "PromptApiService.get"
    And the trace contains a span named "Prompt.compile"
    And the compile span has NO "langwatch.prompt.id" attribute
    And the compile span has NO "langwatch.prompt.handle" attribute
    And the compile span has NO "langwatch.prompt.version.id" attribute
    And the compile span has attribute "langwatch.prompt.variables" equal to the JSON string {"type":"json","value":{}}
    # Python prompt.compile() with no kwargs records an empty variables map; matches that exactly.
    # The live chat turn rides on the LLM-span messages, not on compile variables.
    And the trace drawer "Open in Prompts" menu shows only "Create new prompt"

  # ============================================================================
  # Variables fidelity — what's on the span is what populates the playground
  # ============================================================================

  @integration @v1
  Scenario: every declared variable on the prompt is captured on the compile span
    Given "support-router" version 6 declares input variables "customer_tier" and "input"
    And the playground has "customer_tier" set to "enterprise"
    When I send "I want a refund" through the playground chat
    Then the compile span's "langwatch.prompt.variables" value decodes to
      """
      {"type":"json","value":{"customer_tier":"enterprise","input":"I want a refund"}}
      """

  @integration @v1
  Scenario: error during compile records the exception on the compile span
    Given "support-router" version 6 references an undeclared variable "{{missing}}" in its template
    When I send a chat message through the playground
    Then the compile span has a recorded exception event
    And the compile span still carries id/handle/version.* attributes for the base reference

  # ============================================================================
  # Trace-tree shape — siblings under main, never orphan
  # ============================================================================

  @integration @v1
  Scenario: span hierarchy matches python-sdk shape (get + compile + llm are siblings)
    When I send any chat message through the playground
    Then "PromptApiService.get", "Prompt.compile", and the LLM span share the SAME parent span (the per-event-type root span for playground)
    # Python prompt_tracing.py + prompt_service_tracing.py each open their own start_as_current_span
    # from the current context — compile is NOT nested inside get; they are co-siblings.
    And all three spans share one trace_id
