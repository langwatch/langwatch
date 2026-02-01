@integration
Feature: Evaluation execution - Backend
  As an evaluation system
  I need to orchestrate execution of targets and evaluators
  So that users get accurate results streamed in real-time

  # ==========================================================================
  # Workflow Builder - Prompt Targets
  # ==========================================================================

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

  Scenario: Build workflow for prompt target from database
    Given a saved prompt "test-prompt" with version 1
    And a prompt target referencing prompt "test-prompt"
    And dataset entry with input "Hello"
    When I build the workflow
    Then the workflow contains a signature node from the prompt config
    And the node has inputs mapped from the dataset entry

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

  Scenario: Build workflow with multiple evaluators
    Given a prompt target "target-1"
    And evaluators "exact_match" and "ragas/faithfulness"
    When I build the workflow
    Then the workflow contains evaluator nodes:
      | node_id                     |
      | target-1.exact_match        |
      | target-1.ragas/faithfulness |

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

  Scenario: Execute workflow and receive target result
    Given a workflow with a simple prompt target
    And valid OPENAI_API_KEY in environment
    When I execute the workflow via langwatch_nlp
    Then I receive component_state_change events
    And the target node reaches status "completed"
    And the target node has an output value

  Scenario: Execute workflow and receive evaluator result
    Given a workflow with prompt target and exact_match evaluator
    And dataset entry with expected_output matching actual output
    And valid OPENAI_API_KEY in environment
    When I execute the workflow via langwatch_nlp
    Then the evaluator node reaches status "completed"
    And the evaluator result has passed=true

  Scenario: Execute workflow with failing evaluator
    Given a workflow with prompt target and exact_match evaluator
    And dataset entry with expected_output NOT matching actual output
    And valid OPENAI_API_KEY in environment
    When I execute the workflow via langwatch_nlp
    Then the evaluator result has passed=false

  # ==========================================================================
  # Result Mapper
  # ==========================================================================

  Scenario: Map target result from NLP event
    Given an NLP event component_state_change for node "target-1"
    And the event has status "completed" with output "Hello world"
    When I map the result
    Then I get a target_result with:
      | targetId | target-1    |
      | output   | Hello world |

  Scenario: Map evaluator result from NLP event
    Given an NLP event component_state_change for node "target-1.eval-1"
    And the event has evaluator output with passed=true
    When I map the result
    Then I get an evaluator_result with:
      | targetId    | target-1 |
      | evaluatorId | eval-1   |
      | passed      | true     |

  Scenario: Map target error from NLP event
    Given an NLP event component_state_change for node "target-1"
    And the event has status "error" with error "API key invalid"
    When I map the result
    Then I get a target_result with:
      | targetId | target-1        |
      | error    | API key invalid |

  Scenario: Extract targetId and evaluatorId from composite node ID
    Given node ID "target-abc.evaluator-xyz"
    When I parse the node ID
    Then targetId is "target-abc"
    And evaluatorId is "evaluator-xyz"

  # ==========================================================================
  # Orchestrator - Core
  # ==========================================================================

  Scenario: Orchestrator iterates all cells for full execution
    Given execution scope is "full"
    And 3 dataset rows
    And 2 targets
    When the orchestrator runs
    Then it executes 6 cells (3 rows × 2 targets)

  Scenario: Orchestrator iterates single row
    Given execution scope is row index 1
    And 3 dataset rows
    And 2 targets
    When the orchestrator runs
    Then it executes 2 cells (1 row × 2 targets)

  Scenario: Orchestrator iterates single target
    Given execution scope is target "target-1"
    And 3 dataset rows
    And 2 targets
    When the orchestrator runs
    Then it executes 3 cells (3 rows × 1 target)

  Scenario: Orchestrator iterates single cell
    Given execution scope is cell (row 0, target "target-1")
    When the orchestrator runs
    Then it executes 1 cell

  Scenario: Orchestrator emits execution_started event
    When the orchestrator starts
    Then it emits execution_started with runId and total count

  Scenario: Orchestrator emits cell_started before each cell
    When the orchestrator starts a cell
    Then it emits cell_started with rowIndex and targetId

  Scenario: Orchestrator emits target_result after target completes
    When a target execution completes
    Then it emits target_result with output, cost, duration, traceId

  Scenario: Orchestrator emits evaluator_result after evaluator completes
    When an evaluator execution completes
    Then it emits evaluator_result with SingleEvaluationResult

  Scenario: Orchestrator emits progress after each cell
    Given 6 total cells
    When cell 3 completes
    Then it emits progress with completed=3, total=6

  Scenario: Orchestrator emits done when all cells complete
    When all cells complete successfully
    Then it emits done with ExecutionSummary

  # ==========================================================================
  # Orchestrator - Error Handling
  # ==========================================================================

  Scenario: Target error does not stop execution
    Given 3 cells to execute
    When cell 0 target fails with "API error"
    Then it emits target_result with error="API error"
    And cell 1 and cell 2 continue executing

  Scenario: Evaluator error does not stop execution
    Given an evaluator fails with "Missing input"
    Then it emits evaluator_result with status="error"
    And other evaluators in the cell continue

  Scenario: Workflow execution failure emits error event
    Given the langwatch_nlp service is unreachable
    When the orchestrator tries to execute a cell
    Then it emits error with message and rowIndex and targetId

  # ==========================================================================
  # Orchestrator - Parallelization
  # ==========================================================================

  Scenario: Orchestrator runs cells in parallel
    Given 10 cells to execute
    And max concurrency is 5
    When the orchestrator runs
    Then at most 5 cells execute simultaneously
    And all 10 cells eventually complete

  Scenario: Rate limiting respects semaphore
    Given max concurrency is 3
    When 10 cells are queued
    Then the semaphore limits concurrent executions to 3

  # ==========================================================================
  # Abort Manager
  # ==========================================================================

  Scenario: Request abort sets Redis flag
    Given run ID "run-123"
    When I request abort for "run-123"
    Then Redis key "eval_v3_abort:run-123" is set to "1"

  Scenario: Check abort returns true when flag set
    Given run ID "run-123"
    And abort was requested for "run-123"
    When I check if "run-123" is aborted
    Then it returns true

  Scenario: Check abort returns false when no flag
    Given run ID "run-456" with no abort flag
    When I check if "run-456" is aborted
    Then it returns false

  Scenario: Clear abort removes Redis flag
    Given abort was requested for "run-123"
    When I clear abort for "run-123"
    Then Redis key "eval_v3_abort:run-123" does not exist

  Scenario: Abort flag has TTL for auto-cleanup
    When I request abort for "run-123"
    Then Redis key has TTL of 3600 seconds

  # ==========================================================================
  # Orchestrator - Abort Integration
  # ==========================================================================

  Scenario: Orchestrator checks abort between cells
    Given 10 cells to execute
    And abort is requested after cell 3 starts
    When the orchestrator runs
    Then cells 0-3 may complete (in progress)
    And cells 4-9 do not start
    And it emits stopped with reason="user"

  Scenario: Abort saves partial results
    Given 5 cells completed before abort
    When abort is processed
    Then the 5 completed results are saved to Elasticsearch
    And stopped_at timestamp is set

  Scenario: Abort cancels in-flight LLM requests
    Given a cell is currently streaming a response from the LLM
    When abort is requested
    Then the stream reader is cancelled immediately
    And no more events are processed from that stream
    And the cell is marked as stopped

  Scenario: Abort responds quickly even with many queued cells
    Given 100 cells are queued for execution
    And only 5 are currently in-flight
    When abort is requested immediately
    Then execution stops within seconds
    And at most 5-10 cells complete (those in-flight)
    And the remaining 90+ cells never start

  # ==========================================================================
  # Elasticsearch Storage
  # ==========================================================================

  Scenario: Store results with target_id
    Given a completed cell for target "target-1" row 0
    When I store the result in Elasticsearch
    Then ESBatchEvaluation.dataset entry has target_id="target-1"
    And ESBatchEvaluation.evaluations entries have target_id="target-1"

  Scenario: Upsert results incrementally
    Given run ID "run-123"
    When cell 0 completes
    Then Elasticsearch document is created with run_id="run-123"
    When cell 1 completes
    Then Elasticsearch document is updated (not duplicated)

  Scenario: Set finished_at on completion
    Given all cells complete
    When I finalize the Elasticsearch document
    Then timestamps.finished_at is set

  Scenario: Set stopped_at on abort
    Given execution was aborted
    When I finalize the Elasticsearch document
    Then timestamps.stopped_at is set
    And timestamps.finished_at is NOT set

  Scenario: Store evaluator results in evaluations array
    Given evaluator "exact_match" completed with passed=true
    When I store the result
    Then ESBatchEvaluation.evaluations contains:
      | evaluator    | exact_match |
      | target_id    | target-1    |
      | status       | processed   |
      | passed       | true        |
      | index        | 0           |

  # ==========================================================================
  # Hono SSE Endpoint
  # ==========================================================================

  Scenario: Endpoint requires authentication
    Given no auth token
    When I POST to /api/evaluations/v3/execute
    Then I receive 401 Unauthorized

  Scenario: Endpoint validates request body
    Given invalid request body (missing dataset)
    When I POST to /api/evaluations/v3/execute
    Then I receive 400 Bad Request with validation errors

  Scenario: Endpoint streams SSE events
    Given valid request body
    When I POST to /api/evaluations/v3/execute
    Then the response Content-Type is "text/event-stream"
    And I receive SSE events as execution progresses

  Scenario: Endpoint handles abort request
    Given a running execution "run-123"
    When I POST to /api/evaluations/v3/abort with runId="run-123"
    Then the abort flag is set
    And I receive 200 OK

  # ==========================================================================
  # Error Cases - Integration
  # ==========================================================================

  Scenario: Invalid API key returns error result
    Given invalid OPENAI_API_KEY "sk-invalid"
    When I execute the workflow
    Then the target result has error containing "authentication" or "invalid"

  Scenario: Timeout returns error result
    Given a workflow that takes longer than timeout
    When I execute with timeout 1000ms
    Then the result has error containing "timeout"

  Scenario: Network error returns error result
    Given langwatch_nlp is unreachable
    When I execute the workflow
    Then an error event is emitted with network error message

  # ==========================================================================
  # Workflow Builder - Evaluator Targets
  # ==========================================================================

  Scenario: Build workflow for evaluator target
    Given an evaluator target "target-eval-1" with evaluatorType "langevals/sentiment"
    And dataset entry with output "This is wonderful!"
    When I build the workflow
    Then the workflow contains an evaluator node with id "target-eval-1"
    And the evaluator node has cls "LangWatchEvaluator"
    And the evaluator node has outputs: passed, score, label

  Scenario: Evaluator target node ID is not composite
    Given an evaluator target "target-123" with dbEvaluatorId "eval-abc"
    When I build the workflow
    Then the evaluator node id is "target-123"
    And the node id does NOT contain a dot separator

  Scenario: Evaluator target uses evaluators/{id} path
    Given an evaluator target with dbEvaluatorId "eval-abc"
    When I build the workflow
    Then the evaluator node has evaluator path "evaluators/eval-abc"

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

  Scenario: Evaluator target with value mappings
    Given an evaluator target with input "threshold"
    And a value mapping for "threshold" = "0.8"
    When I build the workflow
    Then the evaluator node has input "threshold" with value "0.8"

  # ==========================================================================
  # Result Mapper - Evaluator Targets
  # ==========================================================================

  Scenario: Evaluator target result maps to target_result event
    Given an NLP event component_state_change for node "target-eval-1"
    And the node is in the targetNodes set
    And the event has evaluator output with passed=true, score=0.95, label="positive"
    When I map the result
    Then I get a target_result with:
      | targetId | target-eval-1                                    |
      | output   | { passed: true, score: 0.95, label: "positive" } |

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

  Scenario: Build workflow with evaluator target and downstream evaluator
    Given an evaluator target "target-eval-1" with outputs passed, score, label
    And a downstream evaluator "meta-eval" with input "value"
    And mapping from "target-eval-1.score" to "meta-eval.value"
    When I build the workflow
    Then the workflow contains nodes: entry, target-eval-1, target-eval-1.meta-eval
    And edge connects "target-eval-1" output "score" to "target-eval-1.meta-eval" input "value"

  Scenario: Downstream evaluator receives evaluator target output
    Given evaluator target "target-eval-1" completed with score=0.95
    And downstream evaluator "meta-eval" maps input "value" to target output "score"
    When the downstream evaluator executes
    Then it receives input "value" with value 0.95

  # ==========================================================================
  # Data Loading - Evaluator Targets
  # ==========================================================================

  Scenario: Load evaluator data for evaluator target
    Given an evaluator target with dbEvaluatorId "eval-abc"
    And evaluator "eval-abc" exists in the database with settings
    When I load execution data
    Then the loaded data includes the evaluator configuration
    And the evaluator settings are available for workflow building