Feature: Workflow agents as scenario and suite targets
  As a LangWatch user
  I want to run scenarios and suites against workflow agents
  So that I can test agents built in the optimization studio

  Background:
    Given I am logged into project "my-project"

  # ============================================================================
  # Schema validation — workflow is accepted as a target type
  # ============================================================================

  @unit
  Scenario: Scenario queue accepts workflow target type
    Given a scenario run job with target type "workflow"
    When the job is validated against the queue schema
    Then validation passes

  @unit
  Scenario: Simulation runner accepts workflow target type
    Given a simulation request with target type "workflow"
    When the request is validated against the simulation target schema
    Then validation passes

  @unit
  Scenario: Suite target accepts workflow target type
    Given a suite with a target of type "workflow"
    When the suite target is validated
    Then validation passes

  # ============================================================================
  # Data prefetching — workflow agent config is loaded before execution
  # ============================================================================

  @unit
  Scenario: Prefetcher fetches workflow agent data
    Given a workflow agent "My Workflow Bot" exists with a published workflow
    And a scenario run targets that workflow agent
    When the data prefetcher runs
    Then it returns the workflow DSL for the published version
    And it returns the workflow input and output fields

  @unit
  Scenario: Prefetcher fails when workflow agent has no published version
    Given a workflow agent "Draft Bot" exists without a published version
    And a scenario run targets that workflow agent
    When the data prefetcher runs
    Then it returns an error indicating no published workflow version

  @unit
  Scenario: Prefetcher fails when workflow agent references missing workflow
    Given a workflow agent "Orphan Bot" references a deleted workflow
    And a scenario run targets that workflow agent
    When the data prefetcher runs
    Then it returns an error indicating the workflow was not found

  # ============================================================================
  # Adapter — workflow execution via NLP service
  # ============================================================================

  @unit
  Scenario: Adapter registry resolves workflow type
    Given the serialized adapter registry
    When a workflow adapter is requested
    Then a SerializedWorkflowAdapter instance is returned

  @unit
  Scenario: Workflow adapter sends DSL to NLP service for execution
    Given a workflow adapter with a valid workflow DSL
    When the adapter executes with input "Hello, I need help"
    Then it sends the workflow DSL to the NLP service execute endpoint
    And it passes the input message as the entry node input

  @unit
  Scenario: Workflow adapter extracts output from end node result
    Given a workflow adapter that has executed a workflow
    And the NLP service returns a result with end node output "I can help you with that"
    When the adapter processes the response
    Then the adapter returns "I can help you with that"

  @unit
  Scenario: Workflow adapter handles execution timeout
    Given a workflow adapter with a valid workflow DSL
    When the NLP service does not respond within the timeout
    Then the adapter raises a timeout error

  @unit
  Scenario: Workflow adapter handles NLP service errors
    Given a workflow adapter with a valid workflow DSL
    When the NLP service returns an error
    Then the adapter raises an execution error with the service message

  @unit
  Scenario: Workflow adapter uses only the latest user message per turn
    Given a workflow adapter with a valid workflow DSL
    And the conversation has multiple user messages
    When the adapter executes
    Then it passes only the last user message as the entry node input

  @unit
  Scenario: Workflow adapter maps input to first entry node field
    Given a workflow with entry node fields "question" and "context"
    When the adapter executes with input "What is your refund policy?"
    Then "question" receives the input message
    And "context" receives an empty string

  # ============================================================================
  # End-to-end — run scenario with workflow target
  # ============================================================================

  @e2e
  Scenario: Run scenario with workflow agent target
    Given scenario "Refund Flow" exists with criteria
    And workflow agent "Studio Bot" is configured as target
    When I click "Run"
    Then the run starts
    And I see the conversation begin

  @e2e
  Scenario: Run suite containing workflow agent target
    Given suite "Integration Tests" exists with scenario "Refund Flow"
    And the suite includes workflow agent "Studio Bot" as a target
    When I trigger the suite run
    Then jobs are scheduled for the workflow target
    And the run completes with results visible in the run history
