Feature: LangWatch MCP setup content is safe to paste into Gemini CLI
  As a user copying a LangWatch MCP setup prompt from the onboarding screen
  I want to paste it into my coding agent without the agent crashing
  So that I can complete the MCP setup and get back to work

  Background:
    Given I am on the LangWatch onboarding screen
    And Gemini CLI is my coding agent

  # ============================================================================
  # Regression: issue #3104 — Gemini CLI crashed with ENAMETOOLONG when a user
  # pasted the tracing setup prompt into its chat input.
  # ============================================================================

  @unit
  Scenario: Pasting the tracing setup prompt does not crash Gemini CLI
    Given I copy the "Add LangWatch tracing to your code" prompt
    When I paste the prompt into Gemini CLI's chat input
    Then Gemini CLI does not crash with ENAMETOOLONG
    And the setup instructions remain legible to the agent

  @unit
  Scenario: Pasting the "level up" prompt does not crash Gemini CLI
    Given I copy the "Level up with everything LangWatch" prompt
    When I paste the prompt into Gemini CLI's chat input
    Then Gemini CLI does not crash with ENAMETOOLONG

  @unit
  Scenario: Pasting the MCP config JSON does not crash Gemini CLI
    Given I copy the MCP config JSON from the onboarding "MCP" tab
    When I paste the config into Gemini CLI's chat input
    Then Gemini CLI does not crash with ENAMETOOLONG
