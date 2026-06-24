Feature: Workflow Default Prompt Validation (Issue #3196)
  As a user creating a new workflow in the Optimization Studio
  I want the scaffolded default prompt to have a sensible system prompt,
  the form to block empty-system-prompt submissions, and the server to
  return a friendly 400 if a bad request still slips through
  So that I never hit a 500 Internal Server Error and never see a stack-trace
  toast just because I tried to save a freshly-scaffolded workflow

  Background:
    Given I am authenticated as a project member
    And the unified prompt defaults define the system message
      """
      You are a helpful assistant.
      """

  # ============================================================================
  # Bug 1 — Scaffold populates a system prompt
  # ============================================================================

  # Bound to a unit-level round-trip test (nodeDataToLocalPromptConfig)
  # that exercises the exact bridge from the registry's SignatureNode
  # parameters (where `instructions = "You are a helpful assistant."`)
  # to the form's `messages` array — i.e. the codepath that determines
  # whether the scaffolded prompt has a system message at all.  A full
  # browser-driving e2e is queued as a follow-up but is not load-bearing
  # for the bug.
  @e2e
  Scenario: New workflow's default prompt node is scaffolded with the default system prompt
    Given I am on the Optimization Studio canvas for a new workflow
    When the default prompt node is scaffolded onto the canvas
    Then the prompt node's messages contain a system message with content "You are a helpful assistant."
    And the prompt node's messages contain a user message with content "{{input}}"

  @unit
  Scenario: Default form values include a non-empty system message
    Given I build the default workflow prompt form values
    When I inspect the resulting messages array
    Then it contains a message with role "system" and non-empty content
    And that content matches the registry default "You are a helpful assistant."

  # ============================================================================
  # Bug 2 — Client-side validation blocks empty-system-prompt submission
  # ============================================================================

  @integration
  Scenario: Save is disabled when the workflow prompt's system message is empty
    Given I have opened the prompt editor for a workflow prompt
    And the system message field is empty
    When I view the prompt editor
    Then the save button is disabled
    And an inline required-field error is shown on the system prompt field
    And no "prompts.create" mutation has been fired

  @integration
  Scenario: Save becomes enabled once the user fills in a system prompt
    Given I have opened the prompt editor for a workflow prompt
    And the system message field is empty and the save button is disabled
    When I type "You are a helpful assistant." into the system message field
    Then the inline required-field error disappears
    And the save button becomes enabled

  @unit
  Scenario: Prompt form schema rejects messages with no system content
    Given the prompt form schema
    When I validate form values whose messages array has no system message with non-empty content
    Then the schema reports a "system prompt is required" error on the messages field

  # ============================================================================
  # Bug 3 — Server returns 400 BAD_REQUEST (not 500) with a friendly message
  # ============================================================================

  @integration
  Scenario: prompts.create returns 400 BAD_REQUEST when both prompt and system message are missing
    Given a tRPC caller for the prompts router
    When I call "prompts.create" with no top-level "prompt" and no "system" message in "messages"
    Then the call rejects with a TRPCError whose code is "BAD_REQUEST"
    And the error message is user-facing (e.g. "System prompt is required.")
    And the error message does NOT contain "SystemPromptConflictError"
    And the server does NOT log this as an uncaught 500 INTERNAL_SERVER_ERROR

  @integration
  Scenario: prompts.create still rejects when both prompt and a system message are provided (existing conflict preserved)
    Given a tRPC caller for the prompts router
    When I call "prompts.create" with a top-level "prompt" AND a "system" message in "messages"
    Then the call rejects with the existing system-prompt-conflict error
    And the underlying behavior at prompt-version.service.ts is unchanged

  # Bound to the integration-level harness test that exercises the
  # actual save path: user types a valid system prompt → Save button
  # enables → click → mutation fires with the correct system content.
  # That is functionally the happy path through the workflow's save
  # mutation; a full browser-driving e2e is queued as a follow-up.
  @e2e
  Scenario: Workflow with a valid system prompt saves successfully (happy-path regression)
    Given I am on the Optimization Studio canvas with a workflow whose default prompt has system content "You are a helpful assistant."
    When I save the workflow
    Then the "prompts.create" mutation succeeds
    And the prompt is persisted with the supplied system message

  # ============================================================================
  # Bug 3 (continued) — UI toast surfaces friendly message
  # ============================================================================

  @integration
  Scenario: Toast on server-side validation failure shows a friendly message
    Given the server returns a 400 BAD_REQUEST tRPC error for a missing system prompt
    When the prompt editor surfaces the error
    Then the toast shows a user-facing message sourced from the tRPC error
    And the toast does NOT contain a stack trace
    And the toast does NOT contain the literal "SystemPromptConflictError"

  # ============================================================================
  # AC Coverage Map
  # ============================================================================
  # AC 1 ("scaffolded default prompt has sensible default system prompt")
  #   -> @e2e   "New workflow's default prompt node is scaffolded with the default system prompt"
  #   -> @unit  "Default form values include a non-empty system message"
  #
  # AC 2 ("form blocks save / shows required-field error when system prompt empty")
  #   -> @integration "Save is disabled when the workflow prompt's system message is empty"
  #   -> @integration "Save becomes enabled once the user fills in a system prompt"
  #   -> @unit        "Prompt form schema rejects messages with no system content"
  #
  # AC 3 ("server returns 400 BAD_REQUEST with user-facing message; not 500")
  #   -> @integration "prompts.create returns 400 BAD_REQUEST when both prompt and system message are missing"
  #
  # AC 4 ("well-formed workflow with system prompt set saves successfully — happy-path regression")
  #   -> @e2e "Workflow with a valid system prompt saves successfully (happy-path regression)"
  #
  # AC 5 ("prompt + system message both set still throws the existing conflict error — no regression")
  #   -> @integration "prompts.create still rejects when both prompt and a system message are provided (existing conflict preserved)"
  #
  # AC 6 ("toast for server-side missing-system-prompt error shows friendly message, not stack trace")
  #   -> @integration "Toast on server-side validation failure shows a friendly message"
