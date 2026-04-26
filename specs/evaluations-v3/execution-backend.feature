@integration
Feature: Evaluation execution - Backend
  As an evaluation system
  I need to orchestrate execution of targets and evaluators
  So that users get accurate results streamed in real-time

  # ==========================================================================
  # Workflow Builder - Prompt Targets
  # ==========================================================================

  @unimplemented
  Scenario: Build workflow for prompt target with local config
    Given a prompt target with local config containing:
      | model       | openai/gpt-4o-mini           |
      | temperature | 0                            |
      | system      | You are a helpful assistant. |
      | user        | Answer: {{input}}            |
    And dataset entry with input "What is 2+2?"
    When I build the workflow
    Then the workflow contains a signature node with:
      | parameter    | value                        |
      | llm.model    | openai/gpt-4o-mini           |
      | instructions | You are a helpful assistant. |
    And the signature node has input "input" with value "What is 2+2?"

  @unimplemented
  Scenario: Build workflow for prompt target from database
    Given a saved prompt "test-prompt" with version 1
    And a prompt target referencing prompt "test-prompt"
    And dataset entry with input "Hello"
    When I build the workflow
    Then the workflow contains a signature node from the prompt config
    And the node has inputs mapped from the dataset entry

  @unimplemented
  Scenario: Build workflow resolves target input mappings
    Given a prompt target with inputs ["question", "context"]
    And dataset columns ["user_input", "background"]
    And target mappings:
      | input    | source.column |
      | question | user_input    |
      | context  | background    |
    And dataset entry:
      | user_input | What is AI? |
      | background | Tech stuff  |
    When I build the workflow
    Then the signature node has:
      | input    | value       |
      | question | What is AI? |
      | context  | Tech stuff  |

  # ==========================================================================
  # Workflow Builder - Agent/Code Targets
  # ==========================================================================

  @unimplemented
  Scenario: Build workflow for code/agent target
    Given a saved agent "test-agent" with code block config
    And an agent target referencing agent "test-agent"
    And dataset entry with input "Test input"
    When I build the workflow
    Then the workflow contains a code node
    And the code node has inputs from the dataset entry

  # ==========================================================================
  # Workflow Builder - Evaluators
  # ==========================================================================

  @unimplemented
  Scenario: Build workflow with exact_match evaluator
    Given a prompt target "target-1"
    And an exact_match evaluator configured with:
      | input           | mapping                |
      | output          | target.output          |
      | expected_output | dataset.expected       |
    When I build the workflow
    Then the workflow contains an evaluator node "target-1.evaluator-1"
    And the evaluator node has cls "LangWatchEvaluator"
    And the evaluator has type "exact_match"

  @unimplemented
  Scenario: Build workflow with multiple evaluators
    Given a prompt target "target-1"
    And evaluators "exact_match" and "ragas/faithfulness"
    When I build the workflow
    Then the workflow contains evaluator nodes:
      | node_id                     |
      | target-1.exact_match        |
      | target-1.ragas/faithfulness |

  @unimplemented
  Scenario: Build workflow edges connect entry to target to evaluators
    Given a prompt target "target-1"
    And an exact_match evaluator
    And mapping from dataset.input to target.input
    And mapping from target.output to evaluator.output
    And mapping from dataset.expected to evaluator.expected_output
    When I build the workflow
    Then the workflow has edge entry -> target-1 on input
    And the workflow has edge target-1 -> evaluator on output
    And the workflow has edge entry -> evaluator on expected_output

  # ==========================================================================
  # Workflow Execution - Integration
  # ==========================================================================

  @unimplemented
  Scenario: Execute workflow and receive target result
    Given a workflow with a simple prompt target
    And valid OPENAI_API_KEY in environment
    When I execute the workflow via langwatch_nlp
    Then I receive component_state_change events
    And the target node reaches status "completed"
    And the target node has an output value

  @unimplemented
  Scenario: Execute workflow and receive evaluator result
    Given a workflow with prompt target and exact_match evaluator
    And dataset entry with expected_output matching actual output
    And valid OPENAI_API_KEY in environment
    When I execute the workflow via langwatch_nlp
    Then the evaluator node reaches status "completed"
    And the evaluator result has passed=true

  @unimplemented
  Scenario: Execute workflow with failing evaluator
    Given a workflow with prompt target and exact_match evaluator
    And dataset entry with expected_output NOT matching actual output
    And valid OPENAI_API_KEY in environment
    When I execute the workflow via langwatch_nlp
    Then the evaluator result has passed=false

  # ==========================================================================
  # Orchestrator - Core
  # ==========================================================================
  @unimplemented
  Scenario: Orchestrator iterates single row
    Given execution scope is row index 1
    And 3 dataset rows
    And 2 targets
    When the orchestrator runs
    Then it executes 2 cells (1 row × 2 targets)

  @unimplemented
  Scenario: Orchestrator emits execution_started event
    When the orchestrator starts
    Then it emits execution_started with runId and total count

  @unimplemented
  Scenario: Orchestrator emits cell_started before each cell
    When the orchestrator starts a cell
    Then it emits cell_started with rowIndex and targetId

  @unimplemented
  Scenario: Orchestrator emits target_result after target completes
    When a target execution completes
    Then it emits target_result with output, cost, duration, traceId

  @unimplemented
  Scenario: Orchestrator emits evaluator_result after evaluator completes
    When an evaluator execution completes
    Then it emits evaluator_result with SingleEvaluationResult

  @unimplemented
  Scenario: Orchestrator emits progress after each cell
    Given 6 total cells
    When cell 3 completes
    Then it emits progress with completed=3, total=6

  @unimplemented
  Scenario: Orchestrator emits done when all cells complete
    When all cells complete successfully
    Then it emits done with ExecutionSummary

  # ==========================================================================
  # Orchestrator - Error Handling
  # ==========================================================================

  @unimplemented
  Scenario: Target error does not stop execution
    Given 3 cells to execute
    When cell 0 target fails with "API error"
    Then it emits target_result with error="API error"
    And cell 1 and cell 2 continue executing

  @unimplemented
  Scenario: Evaluator error does not stop execution
    Given an evaluator fails with "Missing input"
    Then it emits evaluator_result with status="error"
    And other evaluators in the cell continue

  @unimplemented
  Scenario: Workflow execution failure emits error event
    Given the langwatch_nlp service is unreachable
    When the orchestrator tries to execute a cell
    Then it emits error with message and rowIndex and targetId

  # ==========================================================================
  # Orchestrator - Parallelization
  # ==========================================================================

  @unimplemented
  Scenario: Orchestrator runs cells in parallel
    Given 10 cells to execute
    And max concurrency is 5
    When the orchestrator runs
    Then at most 5 cells execute simultaneously
    And all 10 cells eventually complete

  # ==========================================================================
  # Orchestrator - Abort Integration
  # ==========================================================================

  @unimplemented
  Scenario: Orchestrator checks abort between cells
    Given 10 cells to execute
    And abort is requested after cell 3 starts
    When the orchestrator runs
    Then cells 0-3 may complete (in progress)
    And cells 4-9 do not start
    And it emits stopped with reason="user"

  @unimplemented
  Scenario: Abort saves partial results
    Given 5 cells completed before abort
    When abort is processed
    Then the 5 completed results are saved to Elasticsearch
    And stopped_at timestamp is set

  @unimplemented
  Scenario: Abort cancels in-flight LLM requests
    Given a cell is currently streaming a response from the LLM
    When abort is requested
    Then the stream reader is cancelled immediately
    And no more events are processed from that stream
    And the cell is marked as stopped

  # ==========================================================================
  # Hono SSE Endpoint
  # ==========================================================================

  @unimplemented
  Scenario: Endpoint requires authentication
    Given no auth token
    When I POST to /api/evaluations/v3/execute
    Then I receive 401 Unauthorized

  @unimplemented
  Scenario: Endpoint validates request body
    Given invalid request body (missing dataset)
    When I POST to /api/evaluations/v3/execute
    Then I receive 400 Bad Request with validation errors

  @unimplemented
  Scenario: Endpoint streams SSE events
    Given valid request body
    When I POST to /api/evaluations/v3/execute
    Then the response Content-Type is "text/event-stream"
    And I receive SSE events as execution progresses

  @unimplemented
  Scenario: Endpoint handles abort request
    Given a running execution "run-123"
    When I POST to /api/evaluations/v3/abort with runId="run-123"
    Then the abort flag is set
    And I receive 200 OK

  # ==========================================================================
  # Error Cases - Integration
  # ==========================================================================

  @unimplemented
  Scenario: Invalid API key returns error result
    Given invalid OPENAI_API_KEY "sk-invalid"
    When I execute the workflow
    Then the target result has error containing "authentication" or "invalid"

  @unimplemented
  Scenario: Timeout returns error result
    Given a workflow that takes longer than timeout
    When I execute with timeout 1000ms
    Then the result has error containing "timeout"

  @unimplemented
  Scenario: Network error returns error result
    Given langwatch_nlp is unreachable
    When I execute the workflow
    Then an error event is emitted with network error message

  # ==========================================================================
  # Workflow Builder - Evaluator Targets
  # ==========================================================================

  @unimplemented
  Scenario: Build workflow for evaluator target
    Given an evaluator target "target-eval-1" with evaluatorType "langevals/sentiment"
    And dataset entry with output "This is wonderful!"
    When I build the workflow
    Then the workflow contains an evaluator node with id "target-eval-1"
    And the evaluator node has cls "LangWatchEvaluator"
    And the evaluator node has outputs: passed, score, label

  @unimplemented
  Scenario: Build workflow resolves evaluator target input mappings
    Given an evaluator target with inputs ["output", "expected_output"]
    And dataset columns ["response", "expected"]
    And target mappings:
      | input           | source.column |
      | output          | response      |
      | expected_output | expected      |
    And dataset entry:
      | response | Hello world |
      | expected | Hello world |
    When I build the workflow
    Then the evaluator node has:
      | input           | value       |
      | output          | Hello world |
      | expected_output | Hello world |

  # ==========================================================================
  # Result Mapper - Evaluator Targets
  # ==========================================================================

  @unimplemented
  Scenario: Evaluator target result maps to target_result event
    Given an NLP event component_state_change for node "target-eval-1"
    And the node is in the targetNodes set
    And the event has evaluator output with passed=true, score=0.95, label="positive"
    When I map the result
    Then I get a target_result with:
      | targetId | target-eval-1                                    |
      | output   | { passed: true, score: 0.95, label: "positive" } |

  @unimplemented
  Scenario: Evaluator target error maps to target_result with error
    Given an NLP event component_state_change for node "target-eval-1"
    And the node is in the targetNodes set
    And the event has status "error" with error "Invalid input"
    When I map the result
    Then I get a target_result with:
      | targetId | target-eval-1 |
      | error    | Invalid input |

  # ==========================================================================
  # Orchestrator - Evaluator Targets with Downstream Evaluators
  # ==========================================================================

  @unimplemented
  Scenario: Build workflow with evaluator target and downstream evaluator
    Given an evaluator target "target-eval-1" with outputs passed, score, label
    And a downstream evaluator "meta-eval" with input "value"
    And mapping from "target-eval-1.score" to "meta-eval.value"
    When I build the workflow
    Then the workflow contains nodes: entry, target-eval-1, target-eval-1.meta-eval
    And edge connects "target-eval-1" output "score" to "target-eval-1.meta-eval" input "value"

  # ==========================================================================
  # Data Loading - Evaluator Targets
  # ==========================================================================

  @unimplemented
  Scenario: Load evaluator data for evaluator target
    Given an evaluator target with dbEvaluatorId "eval-abc"
    And evaluator "eval-abc" exists in the database with settings
    When I load execution data
    Then the loaded data includes the evaluator configuration
    And the evaluator settings are available for workflow building
