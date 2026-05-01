@issue:1194
Feature: HTTP Agent Support in Evaluations V3
  As a user evaluating AI agents
  I want to use HTTP agents as targets in Evaluations V3
  So that I can evaluate external APIs that expose my agent via HTTP endpoints

  # GitHub Issue: https://github.com/langwatch/langwatch/issues/1194

  Background:
    Given I am in the Evaluations V3 workbench
    And I have a dataset with columns "input, expected_output"

  # ============================================================================
  # UI - Target Editor Routing (currently routes to code editor)
  # ============================================================================

  @integration @unimplemented
  Scenario: Click edit on HTTP agent target opens HTTP editor drawer
    Given I have an HTTP agent target "My API Agent" in the workbench
    When I click the edit button on "My API Agent" target header
    Then the HTTP agent editor drawer opens
    And the form is populated with the agent's URL, method, body template
    And I do NOT see the code editor drawer

  @integration @unimplemented
  Scenario: HTTP agent stays in HTTP editor after creation
    When I click "Add Target"
    And I select "Agent"
    And I click "New Agent"
    And I select "HTTP Agent" type
    And I configure and save the HTTP agent
    Then the HTTP agent is added as a target
    And if I click edit, the HTTP agent editor opens (not code editor)

  # ============================================================================
  # DSL Generation - HTTP Node Creation
  # ============================================================================

  @integration @unimplemented
  Scenario: DSL adapter creates HTTP node for HTTP agent target
    Given an HTTP agent target configured with:
      | url          | https://api.example.com/chat   |
      | method       | POST                           |
      | bodyTemplate | {"messages": {{messages}}}     |
      | outputPath   | $.response.content             |
    When the workflow DSL is built
    Then the workflow contains a node with type "http"
    And the node includes the HTTP config (url, method, bodyTemplate, outputPath)
    And the node does NOT have type "code"

  @integration @unimplemented
  Scenario: DSL adapter resolves HTTP agent input mappings to dataset
    Given an HTTP agent target with inputs "thread_id", "input"
    And target mappings:
      | input     | source         |
      | thread_id | dataset.id     |
      | input     | dataset.input  |
    When the workflow DSL is built
    Then the HTTP node inputs reference the entry node outputs

  @integration @unimplemented
  Scenario: DSL adapter includes auth configuration in HTTP node
    Given an HTTP agent with bearer token authentication
    When the workflow DSL is built
    Then the HTTP node configuration includes auth settings

  # ============================================================================
  # Python Execution - HTTP Node Support in execute_flow
  # ============================================================================

  @integration @unimplemented
  Scenario: execute_flow recognizes HTTP node type
    Given a workflow DSL with an HTTP node
    When execute_flow processes the workflow
    Then the HTTP node is recognized (no "unknown node type" error)

  @integration @unimplemented
  Scenario: HTTP node applies custom headers
    Given an HTTP node with headers:
      | key           | value            |
      | X-Request-ID  | req-456          |
      | X-Environment | production       |
    When execute_flow runs the HTTP node
    Then the request includes all configured headers

  # ============================================================================
  # Error Handling
  # ============================================================================
  @integration @unimplemented
  Scenario: HTTP node returns error when JSONPath finds no match
    Given an HTTP node with outputPath "$.nonexistent.path"
    And the endpoint returns {"data": "value"}
    When execute_flow runs the HTTP node
    Then the node result contains an error
    And the error indicates JSONPath extraction failed

  @integration @unimplemented
  Scenario: HTTP node respects timeout configuration
    Given an HTTP node with timeoutMs 5000
    And an endpoint that takes 10 seconds to respond
    When execute_flow runs the HTTP node
    Then the node result contains a timeout error

  # ============================================================================
  # Evaluator Integration
  # ============================================================================

  @integration @unimplemented
  Scenario: Evaluators receive HTTP agent output
    Given an HTTP agent target that outputs "Hello from API"
    And an evaluator mapped to target.output
    When I run the evaluation
    Then the evaluator receives "Hello from API" as input

  # ============================================================================
  # End-to-End
  # ============================================================================

  @e2e @unimplemented
  Scenario: Full evaluation run with HTTP agent target
    Given I have an HTTP agent target pointing to a mock endpoint
    And the mock endpoint echoes the input
    And I have a dataset with 3 rows
    And I have an exact_match evaluator
    When I click "Evaluate"
    Then the HTTP agent executes for all 3 rows
    And evaluator results appear in the spreadsheet
    And aggregate pass rate is shown in the target header

  @e2e @unimplemented
  Scenario: Single cell re-execution for HTTP agent
    Given I have HTTP agent results from a previous run
    When I click the play button on a specific cell
    Then only that cell's HTTP request is re-executed
    And the evaluators re-run for that cell
