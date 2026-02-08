@integration
Feature: MCP Prompt Tools
  As a coding agent
  I want to manage prompts via the MCP server
  So that I can view and update prompt configurations programmatically

  Background:
    Given the MCP server is configured with a valid API key

  Scenario: Agent lists all prompts
    Given the project has prompts configured
    When the agent calls list_prompts
    Then the response contains a list of prompts
    And each prompt includes handle, name, description, and latest version number

  Scenario: Agent gets a prompt by handle
    Given a prompt exists with handle "customer-support-v2"
    When the agent calls get_prompt with idOrHandle "customer-support-v2"
    Then the response includes the prompt messages
    And the response includes model configuration
    And the response includes version history

  Scenario: Agent creates a new prompt
    When the agent calls create_prompt with:
      | name          | Bug Triage Assistant         |
      | handle        | bug-triage                   |
      | model         | claude-sonnet-4-5-20250929          |
      | modelProvider | anthropic                    |
    And messages containing a system prompt "You are a bug triage assistant"
    Then the response confirms the prompt was created
    And the response includes the new prompt ID and handle

  Scenario: Agent updates a prompt with a new version
    Given a prompt exists with handle "customer-support-v2"
    When the agent calls update_prompt with:
      | idOrHandle    | customer-support-v2                        |
      | commitMessage | Improve response quality for refund queries |
      | createVersion | true                                       |
    And updated messages with improved system prompt
    Then a new version is created
    And the response includes the new version number
