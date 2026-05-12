Feature: Workflow CLI Commands
  As a developer managing LLM pipelines
  I want to manage workflows via CLI commands
  So that I can view and manage workflows without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List workflows
    Given my project has workflows configured
    When I run "langwatch workflow list"
    Then I see a table of workflows with name, ID, tags, and last updated

  Scenario: List workflows when none exist
    Given my project has no workflows
    When I run "langwatch workflow list"
    Then I see a message indicating no workflows were found

  Scenario: List workflows as JSON
    When I run "langwatch workflow list -f json"
    Then I see raw JSON array of workflow objects

  Scenario: Get workflow details by ID
    Given my project has a workflow with ID "workflow_abc123"
    When I run "langwatch workflow get workflow_abc123"
    Then I see workflow details including name, description, evaluator/component flags

  Scenario: Get workflow details as JSON
    When I run "langwatch workflow get workflow_abc123 -f json"
    Then I see raw JSON with workflow details

  Scenario: Get workflow that does not exist
    When I run "langwatch workflow get nonexistent-id"
    Then I see an error that the workflow was not found

  Scenario: Delete a workflow
    Given my project has a workflow with ID "workflow_abc123"
    When I run "langwatch workflow delete workflow_abc123"
    Then the workflow is archived and I see confirmation

  Scenario: Delete a workflow that does not exist
    When I run "langwatch workflow delete nonexistent-id"
    Then I see an error that the workflow was not found

  Scenario: Run workflow command without API key
    Given LANGWATCH_API_KEY is not set
    When I run "langwatch workflow list"
    Then I see an error prompting me to configure my API key
