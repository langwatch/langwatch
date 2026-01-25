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
  # UI - Agent List Drawer (HTTP icon/label missing)
  # ============================================================================

  @integration
  Scenario: HTTP agent displays with correct icon and label in agent list
    Given I have an HTTP agent "My API Agent" saved in the project
    When I click "Add Target"
    And I select "Agent"
    Then I see "My API Agent" in the agent list
    And it displays with a Globe icon
    And it displays "HTTP" as the type label

  # ============================================================================
  # UI - Target Editor Routing (currently routes to code editor)
  # ============================================================================

  @integration
  Scenario: Click edit on HTTP agent target opens HTTP editor drawer
    Given I have an HTTP agent target "My API Agent" in the workbench
    When I click the edit button on "My API Agent" target header
    Then the HTTP agent editor drawer opens
    And the form is populated with the agent's URL, method, body template
    And I do NOT see the code editor drawer

  @integration
  Scenario: HTTP agent stays in HTTP editor after creation
    When I click "Add Target"
    And I select "Agent"
    And I click "New Agent"
    And I select "HTTP Agent" type
    And I configure and save the HTTP agent
    Then the HTTP agent is added as a target
    And if I click edit, the HTTP agent editor opens (not code editor)

  # ============================================================================
  # UI - HTTP Agent Mappings
  # ============================================================================

  @integration
  Scenario: HTTP agent target shows input mapping section
    Given I have an HTTP agent with inputs "thread_id, input"
    When I add it as a target
    And I open the target mappings
    Then I see "thread_id" and "input" as mappable inputs
    And I can map each input to a dataset column or literal value

  @integration
  Scenario: HTTP agent mappings auto-infer from dataset columns
    Given I have dataset columns "input, expected_output, thread_id"
    When I add an HTTP agent with input "thread_id"
    Then the input "thread_id" is automatically mapped to dataset column "thread_id"

  @integration
  Scenario: Missing HTTP agent mappings show alert on target chip
    Given I have an HTTP agent target with required input "messages"
    And "messages" is not mapped to any source
    Then the target header shows a pulsing alert indicator
    And clicking the alert opens the mappings drawer

  # ============================================================================
  # DSL Generation - HTTP Node Creation
  # ============================================================================

  @integration
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

  @integration
  Scenario: DSL adapter resolves HTTP agent input mappings to dataset
    Given an HTTP agent target with inputs "thread_id", "input"
    And target mappings:
      | input     | source         |
      | thread_id | dataset.id     |
      | input     | dataset.input  |
    When the workflow DSL is built
    Then the HTTP node inputs reference the entry node outputs

  @integration
  Scenario: DSL adapter includes auth configuration in HTTP node
    Given an HTTP agent with bearer token authentication
    When the workflow DSL is built
    Then the HTTP node configuration includes auth settings

  # ============================================================================
  # Python Execution - HTTP Node Support in execute_flow
  # ============================================================================

  @integration
  Scenario: execute_flow recognizes HTTP node type
    Given a workflow DSL with an HTTP node
    When execute_flow processes the workflow
    Then the HTTP node is recognized (no "unknown node type" error)

  @integration
  Scenario: HTTP node makes request with configured method and URL
    Given an HTTP node with:
      | url    | https://api.example.com/v1/chat |
      | method | POST                            |
    When execute_flow runs the HTTP node
    Then an HTTP POST request is made to "https://api.example.com/v1/chat"

  @integration
  Scenario: HTTP node interpolates inputs into body template
    Given an HTTP node with:
      | bodyTemplate | {"thread_id": "{{thread_id}}", "message": "{{input}}"} |
    And inputs:
      | thread_id | abc-123       |
      | input     | Hello, world! |
    When execute_flow runs the HTTP node
    Then the request body is {"thread_id": "abc-123", "message": "Hello, world!"}

  @integration
  Scenario: HTTP node extracts output using JSONPath
    Given an HTTP node with outputPath "$.choices[0].message.content"
    And the HTTP endpoint returns:
      """json
      {
        "choices": [
          {"message": {"content": "Hello! How can I help you?"}}
        ]
      }
      """
    When execute_flow runs the HTTP node
    Then the node output is "Hello! How can I help you?"

  @integration
  Scenario: HTTP node applies bearer token authentication
    Given an HTTP node with:
      | auth.type  | bearer        |
      | auth.token | sk-test-12345 |
    When execute_flow runs the HTTP node
    Then the request includes header "Authorization: Bearer sk-test-12345"

  @integration
  Scenario: HTTP node applies API key authentication
    Given an HTTP node with:
      | auth.type   | api_key      |
      | auth.header | X-API-Key    |
      | auth.value  | my-secret-key|
    When execute_flow runs the HTTP node
    Then the request includes header "X-API-Key: my-secret-key"

  @integration
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

  @integration
  Scenario: HTTP node returns error for connection failure
    Given an HTTP node targeting "https://nonexistent.invalid"
    When execute_flow runs the HTTP node
    Then the node result contains an error
    And the error indicates connection/network failure

  @integration
  Scenario: HTTP node returns error for non-2xx response
    Given an HTTP endpoint that returns 401 Unauthorized
    When execute_flow runs the HTTP node
    Then the node result contains an error
    And the error includes status code 401

  @integration
  Scenario: HTTP node returns error when JSONPath finds no match
    Given an HTTP node with outputPath "$.nonexistent.path"
    And the endpoint returns {"data": "value"}
    When execute_flow runs the HTTP node
    Then the node result contains an error
    And the error indicates JSONPath extraction failed

  @integration
  Scenario: HTTP node respects timeout configuration
    Given an HTTP node with timeoutMs 5000
    And an endpoint that takes 10 seconds to respond
    When execute_flow runs the HTTP node
    Then the node result contains a timeout error

  # ============================================================================
  # Evaluator Integration
  # ============================================================================

  @integration
  Scenario: Evaluators receive HTTP agent output
    Given an HTTP agent target that outputs "Hello from API"
    And an evaluator mapped to target.output
    When I run the evaluation
    Then the evaluator receives "Hello from API" as input

  # ============================================================================
  # End-to-End
  # ============================================================================

  @e2e
  Scenario: Full evaluation run with HTTP agent target
    Given I have an HTTP agent target pointing to a mock endpoint
    And the mock endpoint echoes the input
    And I have a dataset with 3 rows
    And I have an exact_match evaluator
    When I click "Evaluate"
    Then the HTTP agent executes for all 3 rows
    And evaluator results appear in the spreadsheet
    And aggregate pass rate is shown in the target header

  @e2e
  Scenario: Single cell re-execution for HTTP agent
    Given I have HTTP agent results from a previous run
    When I click the play button on a specific cell
    Then only that cell's HTTP request is re-executed
    And the evaluators re-run for that cell
