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

  # ==========================================================================
  # Sandbox credential
  # ==========================================================================

  @integration
  Scenario: The run's sandbox credential reaches the code it executes
    Given a run that minted a sandbox credential
    When a cell dispatches its target event
    Then the dispatched workflow carries the credential

  @integration
  Scenario: A run with no minted credential dispatches no credential field
    Given a run that minted no sandbox credential
    When a cell dispatches its target event
    Then the dispatched workflow carries no credential field

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
    Then the 5 completed results are persisted and visible in the run history
    And stopped_at timestamp is set

  # A cell blocked waiting on a slow model must not keep running until that
  # response finally arrives. Stopping the run interrupts it promptly rather
  # than only between streamed results.
  Scenario: Stopping a running workbench execution halts it mid-stream
    Given a workbench execution is streaming results from a slow model
    When the user requests stop
    Then no further results are delivered for that run
    And the run stops

  # ==========================================================================
  # Hono SSE Endpoint
  # ==========================================================================

  # The execute and abort endpoints are driven by the browser workbench, so
  # they authenticate by the logged-in user session, not by a project API key.
  # The public experiments REST API (list endpoint) lives under the same
  # /api/experiments path and authenticates by API key. These two auth models
  # must not collide: the API-key guard must never intercept a session-driven
  # execute request and reject it before the session is checked.

  Scenario: Browser execution authenticates by user session
    Given a logged-in user running an evaluation from the workbench
    And the request carries the user session but no project API key
    When I POST to /api/experiments/execute
    Then the request reaches the session-authenticated execute endpoint
    And it is not rejected by the project API-key guard

  Scenario: Execution endpoint rejects requests with no session
    Given a request with neither a user session nor a project API key
    When I POST to /api/experiments/execute
    Then I receive 401 Unauthorized telling me to log in

  @unimplemented
  Scenario: Endpoint validates request body
    Given invalid request body (missing dataset)
    When I POST to /api/experiments/execute
    Then I receive 400 Bad Request with validation errors

  @unimplemented
  Scenario: Endpoint streams SSE events
    Given valid request body
    When I POST to /api/experiments/execute
    Then the response Content-Type is "text/event-stream"
    And I receive SSE events as execution progresses

  # An interactive workbench run streams its results directly rather than being
  # polled, which is why stopping it used to fail with "Abort Failed". Stopping
  # a run the project owns must now succeed and actually stop it.
  Scenario: Project members can stop their own running workbench execution
    Given my project has a running workbench execution "run-123"
    When I request to stop "run-123"
    Then the request succeeds
    And the execution stops

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

  # ==========================================================================
  # Verdict Identity - one score per target, per evaluator, per row
  # ==========================================================================

  # Every evaluator runs against every target, so two columns produce a verdict
  # for the same evaluator on the same row. Those two verdicts are different
  # facts and both have to survive. When the stored identity of a verdict left
  # the target out, the second column's score was dropped on its way to storage
  # and the results page showed that column with outputs and cost but no score.

  @unit
  Scenario: Two columns keep their own score for the same evaluator and row
    Given a run with two targets scored by the same evaluator
    When both targets produce a verdict for the same row
    Then each target keeps its own verdict
    And neither verdict replaces the other

  @unit
  Scenario: The same verdict sent twice is still stored once
    Given a target that produced a verdict for one evaluator and one row
    When the same verdict is recorded a second time
    Then only one verdict is stored for that target, evaluator and row

  # ==========================================================================
  # Result mapping - what an engine event becomes on the wire
  # ==========================================================================

  @unit
  Scenario: A node id names the target and, after the first dot, the evaluator
    Given an engine event addressed to a node
    When the node id is read
    Then a bare id names a target
    And an id with a dot names a target and the evaluator after the first dot

  @unit
  Scenario: A target's outputs unwrap only when the sole field is the output
    Given a target that finished
    When its outputs are turned into the cell's value
    Then a lone output field becomes the value itself
    And a structured or multi-field payload stays whole
    And no outputs at all leaves the cell empty

  @unit
  Scenario: An evaluator column drops the fields its node no longer emits
    Given a column whose target is itself an evaluator
    When its outputs carry fields the node has stopped filling in
    Then only the fields it still fills in reach the cell
    And a payload of nothing but empty fields leaves the cell empty

  @unit
  Scenario: A workflow evaluator's stringy score and verdict are read as numbers and booleans
    Given a workflow evaluator that reports its score and verdict as text
    When the verdict is stored
    Then a numeric string is read as a score and a true or false string as a verdict
    And prose is read as neither

  @unit
  Scenario: A cell's duration is the wall clock between the engine's timestamps
    Given a cell the engine timed
    When the result is mapped
    Then the cell shows the time between the two timestamps
    And a cell missing either timestamp shows no duration

  @unit
  Scenario: A coded engine failure reaches the cell on the handled channel
    Given a node that failed with a code the engine names
    When the failure is mapped
    Then the cell carries the code and the trace, not the engine's own words
    And an upstream status the provider answered with travels with it
    And a failure with no code leaves the handled channel empty

  @unit
  Scenario: A guardrail evaluator stores its verdict without a meaningless score
    Given a guardrail evaluator whose score is only ever pass or fail
    When its verdict is stored
    Then the verdict is stored without the score
    And every other evaluator keeps its score

  @unit
  Scenario: An execution failure outranks the evaluator's own error output
    Given an evaluator whose call failed and whose output also reports an error
    When the verdict is stored
    Then the cell reports the failure of the call

  @unit
  Scenario: An evaluator's details survive only when they are real text
    Given an evaluator that reports details
    When the verdict is stored
    Then empty or absent details are dropped
    And real text is kept

  @unit
  Scenario: A comparison verdict persists only the candidate ids it judged
    Given a comparison judge that was sent a list of candidates
    When its verdict is stored
    Then only which candidates were judged is kept
    And an evaluator that judged no candidate list persists nothing

  @unit
  Scenario: A verdict addressed to no evaluator fails loudly
    Given a verdict whose node id names no evaluator
    When it is mapped
    Then mapping fails rather than storing a verdict against nothing

  @unit
  Scenario: Only a finished node's event becomes a result
    Given a stream of engine events
    When a node is still running, or the event is the entry node, a debug frame or the done frame
    Then nothing is recorded for it

  @unit
  Scenario: A finished node's event lands in the cell it names
    Given a stream of engine events
    When a target node finishes
    Then its output, cost and duration land in that target's cell for that row
    And an evaluator node's verdict lands under the evaluator its node id names

  @unit
  Scenario: A named failure reaches the customer as its code, an unnamed one as a marker
    Given a failure thrown while a run is in flight
    When we know what went wrong
    Then the customer's client is sent the code and the payload it renders from
    And when we do not, the event carries a marker and no host, port or internal words
    And a failure that took the whole run says no more than one that took a cell

  @unit
  Scenario: A workflow evaluator's verdict shows the node's name, not its id
    Given an evaluator node inside a studio workflow
    When its verdict is stored
    Then the node's display name travels with it
    And a node with no display name leaves the name unset

  # ==========================================================================
  # Cell planning - what a run's scope plans
  # ==========================================================================

  @unit
  Scenario: A run's scope decides which rows it may touch
    Given a run over a dataset
    When its scope is a full run, a whole column, or one evaluator over all rows
    Then it may touch every row
    And a scope naming rows may touch only those rows, once each, dropping any that are gone
    And a cell scope may touch only its own row

  @unit
  Scenario: A run plans one cell per scoped row and scoped column
    Given a run over a dataset
    When its cells are planned
    Then there is one cell for each scoped row in each scoped column
    And a scope naming a column that no longer exists plans nothing
    And the count published before the run matches the cells it runs

  @unit
  Scenario: A run's cells come out row by row
    Given a run over several rows and several columns
    When its cells are planned
    Then every column of a row is planned before the next row

  @unit
  Scenario: A cell carries its row and the dataset the row came from
    Given a run over a dataset
    When its cells are planned
    Then each cell carries its row's fields and the dataset they came from
    And every scoring evaluator is attached to every cell

  @unit
  Scenario: A row with nothing in it is not run
    Given a dataset with an empty row
    When the run's cells are planned
    Then the empty row is skipped

  @unit
  Scenario: A comparison waits for phase two rather than running per column
    Given a workbench with a comparison
    When the run's cells are planned
    Then no comparison evaluator is attached to a per-column cell
    And a comparison that is its own column plans no cell of its own yet

  @unit
  Scenario: Re-running a comparison does not re-run the columns it already has
    Given a run scoped to a comparison column
    When the run's cells are planned
    Then the columns the comparison compares are pulled in
    And a column whose answer for that row was carried over is left alone

  @unit
  Scenario: Re-running one evaluator reuses the outputs already on the row
    Given a run re-running one evaluator over the rows that already have outputs
    When its cells are planned
    Then only that evaluator runs, against the output already on the row
    And an evaluator that is gone, or one that needs every column, plans nothing
