Feature: Auto-detect prompt variables during sync
  As a developer using `langwatch prompt sync`
  I want template variables in my prompt text to be automatically detected and created as inputs
  So that the platform shows them correctly without "Undefined variables" warnings

  # The 1 remaining @unimplemented scenario is UPDATE per AUDIT_MANIFEST.md:
  # mergeAutoDetectedInputs preserves the CLI default "input" even when absent
  # from the template (pinned first), but the scenario wording says it's only
  # kept when it appears in the template. Wording contradicts current behavior.
  # All other detection/sorting/preserve scenarios are fully covered by
  # mergeAutoDetectedInputs.unit.test.ts and syncPromptAutoDetect.integration.test.ts.
  # Aspirational pending UPDATE-class scenario rewrite tracked in PR #3458.

  Background:
    Given a project with the Prompts CLI configured
    And the server uses Liquid-aware variable extraction (shared with frontend)

  # --- Variable extraction (pure logic) ---

  @integration
  Scenario: CLI hardcoded "input" default is kept only when it appears in the template
    Given a prompt with text "hello {{name}}"
    And the sync payload has inputs [{ identifier: "input", type: "str" }] (CLI default)
    When syncPrompt processes the request
    Then the resulting inputs contain "input" and "name"
    # The server cannot distinguish CLI defaults from intentional inputs

  # --- Diff stability ---
