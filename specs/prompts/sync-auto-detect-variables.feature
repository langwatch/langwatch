Feature: Auto-detect prompt variables during sync
  As a developer using `langwatch prompt sync`
  I want template variables in my prompt text to be automatically detected and created as inputs
  So that the platform shows them correctly without "Undefined variables" warnings

  Background:
    Given a project with the Prompts CLI configured
    And the server uses Liquid-aware variable extraction (shared with frontend)

  # --- Variable extraction (pure logic) ---

  @unit @unimplemented
  Scenario: CLI hardcoded "input" default is kept only when it appears in the template
    Given a prompt with text "hello {{name}}"
    And the sync payload has inputs [{ identifier: "input", type: "str" }] (CLI default)
    When syncPrompt processes the request
    Then the resulting inputs contain "input" and "name"
    # The server cannot distinguish CLI defaults from intentional inputs

  # --- Diff stability ---
