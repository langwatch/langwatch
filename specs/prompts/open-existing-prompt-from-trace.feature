Feature: Open existing prompt from trace
  As a user viewing a trace that used a LangWatch prompt
  I want "Open in Prompts" to offer opening the original prompt with traced variables
  So that I can reproduce and iterate on exactly what happened in production

  Background:
    Given a project with traced LLM calls
    And a prompt "team/sample-prompt" exists with versions 1, 2, and 3
    And tag "production" is assigned to version 2 of "team/sample-prompt"

  # --- SDK attribute format ---
  # When a LangWatch prompt is used, the SDK sets:
  #   langwatch.prompt.id = "handle:version_number" (e.g. "team/sample-prompt:3")
  #   langwatch.prompt.variables = '{"type":"json","value":{"name":"Alice","topic":"AI"}}'
  #
  # Version is always present — the SDK resolves the exact version at runtime.
  # If handle or version is unavailable (e.g. prompt has no handle), emit nothing.
  # No fallback to old separate-attribute format.

  # --- SDK: emit handle:version or nothing ---

  @unit @unimplemented
  Scenario: SDK emits combined prompt handle and version attribute
    Given a prompt "team/sample-prompt" at version 3 is used in an LLM call
    When the SDK traces the call
    Then the span attribute "langwatch.prompt.id" is set to "team/sample-prompt:3"

  @unit @unimplemented
  Scenario: SDK emits nothing when prompt has no handle
    Given a prompt without a handle is used in an LLM call
    When the SDK traces the call
    Then no "langwatch.prompt.id" attribute is set

  @unit @unimplemented
  Scenario: SDK captures variables from compile
    Given a prompt is compiled with variables name="Alice" and topic="AI"
    When the SDK traces the compile call
    Then the span attribute "langwatch.prompt.variables" contains the variables

  # --- UI: "Open in Prompts" becomes a menu when prompt reference exists ---

  @unit @unimplemented
  Scenario: Opens existing prompt at traced version with variables applied
    Given a traced LLM call has "langwatch.prompt.id" = "team/sample-prompt:3"
    And the trace has variables name="Alice" and topic="AI"
    When I choose "Open team/sample-prompt:3" from the menu
    Then the Playground opens a tab with prompt "team/sample-prompt" at version 3
    And the playground variables are set to name="Alice" and topic="AI"
    And the chat history from the trace is loaded

  @unit @unimplemented
  Scenario: Creates missing variables on the prompt when they dont exist
    Given prompt "team/sample-prompt" version 3 has variables name and topic
    And the trace has variables name="Alice", topic="AI", and extra_context="some context"
    When I choose "Open team/sample-prompt:3" from the menu
    Then the Playground opens the prompt at version 3
    And variable extra_context is added to the playground variables
    And all three variables are populated with the traced values

  @unit @unimplemented
  Scenario: Trace references a prompt that no longer exists
    Given a traced LLM call has "langwatch.prompt.id" = "team/deleted-prompt:1"
    And prompt "team/deleted-prompt" does not exist in the project
    When I choose "Open team/deleted-prompt:1" from the menu
    Then a new playground tab is created from the trace data
    And a warning toast is shown that the original prompt was not found

  @unit @unimplemented
  Scenario: Trace references a version that no longer exists
    Given a traced LLM call has "langwatch.prompt.id" = "team/sample-prompt:99"
    And version 99 does not exist for "team/sample-prompt"
    When I choose "Open team/sample-prompt:99" from the menu
    Then the Playground opens prompt "team/sample-prompt" at the latest version
    And a warning toast is shown that the traced version was not found

  # --- "Create new prompt" action ---

  @unit @unimplemented
  Scenario: Create new prompt from trace data
    Given a traced LLM call has "langwatch.prompt.id" = "team/sample-prompt:3"
    When I choose "Create new prompt" from the menu
    Then a new playground tab is created from the trace data
    And no existing prompt is loaded
    And the chat history from the trace is loaded

  # --- Backend extraction ---

  @unit @unimplemented
  Scenario: Opens existing prompt at tagged version with variables applied
    Given a traced LLM call has "langwatch.prompt.id" = "team/sample-prompt:production"
    And the trace has variables name="Alice" and topic="AI"
    When I choose "Open team/sample-prompt:production" from the menu
    Then the Playground opens a tab with prompt "team/sample-prompt" at the version tagged "production"
    And the playground variables are set to name="Alice" and topic="AI"
    And the chat history from the trace is loaded

  @unit @unimplemented
  Scenario: Auto-detects open-existing action for tagged prompt reference
    Given a traced LLM span has attribute "langwatch.prompt.id" = "team/sample-prompt:production"
    When the playground determines the action for this span
    Then the effective action is "open-existing"

  @unit @unimplemented
  Scenario: Tag-based open does not show version-not-found toast
    Given a traced LLM call has "langwatch.prompt.id" = "team/sample-prompt:production"
    When I choose "Open team/sample-prompt:production" from the menu
    Then the Playground opens the prompt at the version tagged "production"
    And no "version not found" toast is shown

  @unit @unimplemented
  Scenario: Trace references a tag that is not assigned to any version
    Given a traced LLM call has "langwatch.prompt.id" = "team/sample-prompt:staging"
    And tag "staging" is not assigned to any version of "team/sample-prompt"
    When I choose "Open team/sample-prompt:staging" from the menu
    Then a new playground tab is created from the trace data
    And a warning toast is shown that the tag could not be resolved

  @unit @unimplemented
  Scenario: Trace references a tagged prompt that no longer exists
    Given a traced LLM call has "langwatch.prompt.id" = "team/deleted-prompt:production"
    And prompt "team/deleted-prompt" does not exist in the project
    When I choose "Open team/deleted-prompt:production" from the menu
    Then a new playground tab is created from the trace data
    And a warning toast is shown that the original prompt was not found

  # Note: This scenario is already covered by existing trace service tests from PR #2826
  # which added promptTag propagation through ClickHouse and Elasticsearch services.
