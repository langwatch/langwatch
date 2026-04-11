Feature: MCP setup prompts stay safe to paste into any CLI agent
  As a user copying a LangWatch MCP setup prompt into my coding agent
  I want the pasted content not to crash the agent's parser
  So that I can complete MCP setup without a CLI crash

  Background:
    Given LangWatch exports onboarding prompts from code-prompts.ts
    And those prompts instruct an agent to install the "@langwatch/mcp-server" package

  # ============================================================================
  # Regression: Gemini CLI ENAMETOOLONG crash (issue #3104)
  # ============================================================================
  # Gemini CLI's chat input runs an `@`-file-reference parser on pasted text.
  # If any `@`-prefixed run exceeds the OS filesystem NAME_MAX (255 chars on
  # macOS / Linux), Gemini calls lstat() on it and crashes with ENAMETOOLONG.
  # A JSON snippet like "@langwatch/mcp-server"],\n  "env": { ... } triggers
  # the parser's double-quoted-run alternative, which eats across newlines.

  @unit
  Scenario: No exported prompt contains an @-prefixed run longer than 100 characters
    When I scan each exported PROMPT_* string with Gemini CLI's atCommandProcessor regex
    Then every match is shorter than 100 characters

  @unit
  Scenario: Tracing prompt does not embed @langwatch/mcp-server inside a JSON string literal
    When I scan PROMPT_TRACING for the pattern "@langwatch/mcp-server\""
    Then no match is found

  @unit
  Scenario: Shared MCP setup markdown avoids the same pattern
    When I scan skills/_shared/mcp-setup.md for "@langwatch/mcp-server\""
    Then no match is found
