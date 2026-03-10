Feature: Open existing prompt from trace
  As a user viewing a trace that used a LangWatch prompt
  I want "Open in Prompts" to navigate directly to that prompt at the exact version
  So that I can see and iterate on the prompt that produced the traced output

  Background:
    Given a project with traced LLM calls
    And a prompt "team/sample-prompt" exists with versions 1, 2, and 3

  # --- SDK attribute format ---
  # When a LangWatch prompt is used, the SDK sets a single span attribute:
  #   langwatch.prompt.id = "handle:version_number"
  # e.g. "team/sample-prompt:3"
  #
  # Version is always present because even when the user requests "latest",
  # the SDK resolves the exact version at runtime and traces it for
  # perfect reproducibility.
  #
  # Parsing uses lastIndexOf(':') to split handle from version number.
  # Handles must not contain colons (validated at creation time).
  #
  # When a prompt has no handle (created via UI without setting one),
  # the SDK falls back to the old separate-attribute format.

  # --- SDK changes ---

  @unit
  Scenario: SDK emits combined prompt handle and version attribute
    Given a prompt "team/sample-prompt" at version 3 is used in an LLM call
    When the SDK traces the call
    Then the span attribute "langwatch.prompt.id" is set to "team/sample-prompt:3"

  @unit
  Scenario: SDK falls back to old format when prompt has no handle
    Given a prompt without a handle (UUID only) at version 2 is used
    When the SDK traces the call
    Then the span attribute "langwatch.prompt.id" is set to the prompt UUID
    And the span attribute "langwatch.prompt.version.id" is set to the version UUID

  @unit
  Scenario: SDK only sets prompt attributes after successful resolution
    Given a prompt fetch fails with a network error
    When the SDK traces the call
    Then no prompt reference attributes are set on the span
    And the span records the exception

  # --- Open in Prompts: opening existing prompt ---

  @unit
  Scenario: Trace with prompt reference opens existing prompt at that version
    Given a traced LLM call has span attribute "langwatch.prompt.id" = "team/sample-prompt:3"
    When I open the trace in the Playground
    Then the Playground opens a tab with prompt "team/sample-prompt" at version 3

  @unit
  Scenario: Trace without prompt reference creates a new playground entry
    Given a traced LLM call has no prompt reference attributes
    When I open the trace in the Playground
    Then a new playground tab is created from the trace data

  # --- Retrocompat with old SDK format ---

  @unit
  Scenario: Trace with old-format separate prompt attributes opens existing prompt
    Given a traced LLM call has span attribute "langwatch.prompt.handle" = "team/sample-prompt"
    And span attribute "langwatch.prompt.version.number" = "2"
    When I open the trace in the Playground
    Then the Playground opens a tab with prompt "team/sample-prompt" at version 2

  @unit
  Scenario: Trace with old-format UUID-only attributes falls back to new entry
    Given a traced LLM call has span attribute "langwatch.prompt.id" without a colon
    And span attribute "langwatch.prompt.version.id" is present
    When I open the trace in the Playground
    Then a new playground tab is created from the trace data

  # --- Edge cases ---

  @unit
  Scenario: Trace references a prompt that no longer exists
    Given a traced LLM call has span attribute "langwatch.prompt.id" = "team/deleted-prompt:1"
    And prompt "team/deleted-prompt" does not exist in the project
    When I open the trace in the Playground
    Then a new playground tab is created from the trace data
    And a warning toast is shown that the original prompt was not found

  @unit
  Scenario: Trace references a version that no longer exists
    Given a traced LLM call has span attribute "langwatch.prompt.id" = "team/sample-prompt:99"
    And version 99 does not exist for "team/sample-prompt"
    When I open the trace in the Playground
    Then the Playground opens prompt "team/sample-prompt" at the latest version
    And a warning toast is shown that the traced version was not found

  # --- Backend extraction ---

  @integration
  Scenario: Backend extracts new-format prompt reference from span attributes
    Given a span with attribute "langwatch.prompt.id" = "team/sample-prompt:3"
    When the getForPromptStudio API is called
    Then the response includes promptHandle "team/sample-prompt" and promptVersionNumber 3

  @integration
  Scenario: Backend extracts old-format prompt reference from separate attributes
    Given a span with attribute "langwatch.prompt.handle" = "team/sample-prompt"
    And attribute "langwatch.prompt.version.number" = "2"
    When the getForPromptStudio API is called
    Then the response includes promptHandle "team/sample-prompt" and promptVersionNumber 2

  @integration
  Scenario: Backend returns null prompt reference when no prompt attributes exist
    Given a span with no langwatch.prompt.* attributes
    When the getForPromptStudio API is called
    Then the response has promptHandle null and promptVersionNumber null
