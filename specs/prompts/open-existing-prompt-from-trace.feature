Feature: Open existing prompt from trace
  As a user viewing a trace that used a LangWatch prompt
  I want "Open in Prompts" to offer opening the original prompt with traced variables
  So that I can reproduce and iterate on exactly what happened in production

  Background:
    Given a project with traced LLM calls
    And a prompt "team/sample-prompt" exists with versions 1, 2, and 3

  # --- SDK attribute format ---
  # When a LangWatch prompt is used, the SDK sets:
  #   langwatch.prompt.id = "handle:version_number" (e.g. "team/sample-prompt:3")
  #   langwatch.prompt.variables = '{"type":"json","value":{"name":"Alice","topic":"AI"}}'
  #
  # Version is always present — the SDK resolves the exact version at runtime.
  # If handle or version is unavailable (e.g. prompt has no handle), emit nothing.
  # No fallback to old separate-attribute format.

  # --- SDK: emit handle:version or nothing ---

  @unit
  Scenario: SDK emits combined prompt handle and version attribute
    Given a prompt "team/sample-prompt" at version 3 is used in an LLM call
    When the SDK traces the call
    Then the span attribute "langwatch.prompt.id" is set to "team/sample-prompt:3"

  @unit
  Scenario: SDK emits nothing when prompt has no handle
    Given a prompt without a handle is used in an LLM call
    When the SDK traces the call
    Then no "langwatch.prompt.id" attribute is set

  @unit
  Scenario: SDK captures variables from compile
    Given a prompt is compiled with variables name="Alice" and topic="AI"
    When the SDK traces the compile call
    Then the span attribute "langwatch.prompt.variables" contains the variables

  # --- UI: "Open in Prompts" becomes a menu when prompt reference exists ---

  @unit
  Scenario: Button becomes a dropdown menu when trace has prompt reference
    Given a traced LLM span has attribute "langwatch.prompt.id" = "team/sample-prompt:3"
    When I view the span details
    Then the "Open in Prompts" button shows a dropdown menu
    And the menu has option "Open team/sample-prompt:3"
    And the menu has option "Create new prompt"

  @unit
  Scenario: Button stays as simple button when trace has no prompt reference
    Given a traced LLM span has no "langwatch.prompt.id" attribute
    When I view the span details
    Then the "Open in Prompts" button behaves as a simple button
    And clicking it creates a new prompt from trace data

  # --- "Open team/sample-prompt:3" action ---

  @unit
  Scenario: Opens existing prompt at traced version with variables applied
    Given a traced LLM call has "langwatch.prompt.id" = "team/sample-prompt:3"
    And the trace has variables name="Alice" and topic="AI"
    When I choose "Open team/sample-prompt:3" from the menu
    Then the Playground opens a tab with prompt "team/sample-prompt" at version 3
    And the playground variables are set to name="Alice" and topic="AI"
    And the chat history from the trace is loaded

  @unit
  Scenario: Creates missing variables on the prompt when they dont exist
    Given prompt "team/sample-prompt" version 3 has variables name and topic
    And the trace has variables name="Alice", topic="AI", and extra_context="some context"
    When I choose "Open team/sample-prompt:3" from the menu
    Then the Playground opens the prompt at version 3
    And variable extra_context is added to the playground variables
    And all three variables are populated with the traced values

  @unit
  Scenario: Trace references a prompt that no longer exists
    Given a traced LLM call has "langwatch.prompt.id" = "team/deleted-prompt:1"
    And prompt "team/deleted-prompt" does not exist in the project
    When I choose "Open team/deleted-prompt:1" from the menu
    Then a new playground tab is created from the trace data
    And a warning toast is shown that the original prompt was not found

  @unit
  Scenario: Trace references a version that no longer exists
    Given a traced LLM call has "langwatch.prompt.id" = "team/sample-prompt:99"
    And version 99 does not exist for "team/sample-prompt"
    When I choose "Open team/sample-prompt:99" from the menu
    Then the Playground opens prompt "team/sample-prompt" at the latest version
    And a warning toast is shown that the traced version was not found

  # --- "Create new prompt" action ---

  @unit
  Scenario: Create new prompt from trace data
    Given a traced LLM call has "langwatch.prompt.id" = "team/sample-prompt:3"
    When I choose "Create new prompt" from the menu
    Then a new playground tab is created from the trace data
    And no existing prompt is loaded
    And the chat history from the trace is loaded

  # --- Backend extraction ---

  @integration
  Scenario: Backend extracts prompt reference and variables from span attributes
    Given a span with attribute "langwatch.prompt.id" = "team/sample-prompt:3"
    And attribute "langwatch.prompt.variables" with variables name="Alice"
    When the getForPromptStudio API is called
    Then the response includes promptHandle "team/sample-prompt" and promptVersionNumber 3
    And the response includes promptVariables with name="Alice"

  @integration
  Scenario: Backend returns null prompt reference when no prompt attributes exist
    Given a span with no langwatch.prompt.* attributes
    When the getForPromptStudio API is called
    Then the response has promptHandle null and promptVersionNumber null
    And the response has promptVariables null

  # --- Ancestor span lookup ---
  # The SDK sets langwatch.prompt.id on the Prompt.compile/get span (parent),
  # not on the LLM span itself. The backend must walk up the parent chain.

  @unit
  Scenario: Prompt reference found on immediate parent span
    Given an LLM span with no langwatch.prompt.id attribute
    And its parent span has "langwatch.prompt.id" = "team/sample-prompt:3"
    When the prompt reference is looked up
    Then the prompt reference is found with handle "team/sample-prompt" and version 3

  @unit
  Scenario: Prompt reference found on grandparent span
    Given an LLM span with no langwatch.prompt.id attribute
    And its grandparent span has "langwatch.prompt.id" = "team/sample-prompt:3"
    When the prompt reference is looked up
    Then the prompt reference is found with handle "team/sample-prompt" and version 3

  @unit
  Scenario: No prompt reference on any ancestor span
    Given an LLM span with no langwatch.prompt.id attribute
    And no ancestor spans have a langwatch.prompt.id attribute
    When the prompt reference is looked up
    Then no prompt reference is found

  # --- Metadata hoisting: combine prompt IDs across spans ---

  @unit
  Scenario: Single span prompt ID is hoisted to trace-level metadata
    Given a trace with one span having "langwatch.prompt.id" = "team/sample-prompt:3"
    When the trace summary is computed
    Then the trace attribute "langwatch.prompt_ids" contains ["team/sample-prompt:3"]
    And the per-span "langwatch.prompt.id" is not present at trace level

  @unit
  Scenario: Multiple spans with different prompts are combined
    Given a trace with spans using "team/prompt-a:1" and "team/prompt-b:2"
    When the trace summary is computed
    Then the trace attribute "langwatch.prompt_ids" contains ["team/prompt-a:1", "team/prompt-b:2"]

  @unit
  Scenario: Duplicate prompt IDs across spans are deduplicated
    Given two spans both using "team/sample-prompt:3"
    When the trace summary is computed
    Then the trace attribute "langwatch.prompt_ids" contains ["team/sample-prompt:3"]

  # --- Retrocompat with old SDK format ---
  # Old SDKs emitted separate attributes. We still parse them for backward compat
  # but don't emit them from new SDKs.

  @integration
  Scenario: Backend extracts old-format separate prompt attributes
    Given a span with attribute "langwatch.prompt.handle" = "team/sample-prompt"
    And attribute "langwatch.prompt.version.number" = "2"
    When the getForPromptStudio API is called
    Then the response includes promptHandle "team/sample-prompt" and promptVersionNumber 2
