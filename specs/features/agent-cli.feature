Feature: Agent CLI Commands
  As a developer managing agent definitions
  I want to manage agents via CLI commands
  So that I can create and configure agents without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List agents
    Given my project has agents configured
    When I run "langwatch agent list"
    Then I see a table of all agents with name, ID, type, and last updated

  Scenario: List agents when none exist
    Given my project has no agents
    When I run "langwatch agent list"
    Then I see a message indicating no agents were found

  Scenario: List agents as JSON
    When I run "langwatch agent list -f json"
    Then I see raw JSON with agent data and pagination

  Scenario: Get agent details by ID
    Given my project has an agent with ID "agent_abc123"
    When I run "langwatch agent get agent_abc123"
    Then I see agent details including name, type, and configuration

  Scenario: Get agent details as JSON
    Given my project has an agent with ID "agent_abc123"
    When I run "langwatch agent get agent_abc123 -f json"
    Then I see raw JSON with agent details

  Scenario: Get agent that does not exist
    When I run "langwatch agent get nonexistent-id"
    Then I see an error that the agent was not found

  Scenario: Create an HTTP agent
    When I run "langwatch agent create 'My API Agent' --type http --config '{"url":"https://api.example.com"}'"
    Then a new agent is created and I see confirmation with its name and ID

  Scenario: Create an agent without required type
    When I run "langwatch agent create 'My Agent'"
    Then I see an error that the --type option is required

  Scenario: Delete an agent
    Given my project has an agent with ID "agent_abc123"
    When I run "langwatch agent delete agent_abc123"
    Then the agent is archived and I see confirmation

  Scenario: Delete an agent that does not exist
    When I run "langwatch agent delete nonexistent-id"
    Then I see an error that the agent was not found

  Scenario: Run agent command without API key
    Given LANGWATCH_API_KEY is not set
    When I run "langwatch agent list"
    Then I see an error prompting me to configure my API key
