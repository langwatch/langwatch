Feature: Workflow execution engine — DSL parsing, DAG resolution, lifecycle
  The Go engine takes a Studio workflow JSON, builds a directed acyclic graph
  from its nodes and edges, executes nodes in topological layers, streams
  state changes back to the caller, and produces a terminal result that is
  byte-equivalent to the Python implementation for the same input.

  See _shared/contract.md §5, §6, §10.

  Background:
    Given nlpgo is listening on :5562
    And nlpgo imports the AI Gateway dispatcher in-process (see contract.md §8)

  Rule: Workflow JSON deserializes losslessly

    @unit
    Scenario: every node kind in the v1 scope round-trips
      Given a workflow JSON containing nodes of kinds "entry", "signature", "code", "http", "end", "prompting_technique"
      When the engine deserializes the workflow
      Then no fields are dropped
      And re-serializing the parsed workflow produces JSON canonically equal to the input

    @unit
    Scenario: unsupported node kinds produce a structured error before execution
      Given a workflow JSON containing a node of kind "agent"
      When the engine attempts to plan execution
      Then the engine returns a 501 with body {"error": {"type": "unsupported_node_kind", "node_kind": "agent"}}
      And no nodes are executed

    @unit
    Scenario Outline: field types parse with the expected Go representation
      Given a node parameter of declared type <field_type> with value <example>
      When the engine reads the parameter
      Then the in-memory representation matches <go_type>

      Examples:
        | field_type     | example                                      | go_type                  |
        | str            | "hello"                                      | string                   |
        | int            | 42                                           | int64                    |
        | float          | 3.14                                         | float64                  |
        | bool           | true                                         | bool                     |
        | list[str]      | ["a","b"]                                    | []string                 |
        | dict           | {"k":"v"}                                    | map[string]any           |
        | json_schema    | {"type":"object","properties":{}}            | parsed JSON Schema       |
        | chat_messages  | [{"role":"user","content":"hi"}]             | []ChatMessage            |
        | dataset        | {"records":{"input":["x"]}}                  | DatasetInline            |

  Rule: DAG resolution rejects cycles and missing edges

    @unit
    Scenario: a cycle in the workflow is rejected before any node runs
      Given a workflow with edges A->B, B->C, C->A
      When the engine plans execution
      Then the engine returns a 400 with body {"error": {"type": "invalid_workflow", "reason": "cycle_detected"}}

    @unit
    Scenario: an edge whose source_node does not exist is rejected
      Given a workflow with an edge from "ghost_node" to "entry"
      When the engine plans execution
      Then the engine returns a 400 with body {"error": {"type": "invalid_workflow", "reason": "unknown_node", "node_id": "ghost_node"}}

  Rule: Topological execution preserves dependencies and parallelizes within a layer

    @integration
    Scenario: nodes within the same layer execute concurrently
      Given a workflow where the entry fans out to three independent HTTP nodes that each sleep 200ms
      When I POST /go/studio/execute_sync with a valid input
      Then the response status is 200
      And the total wall-clock time is less than 500ms
      And each HTTP node's "duration_ms" is between 180 and 400

    @integration
    Scenario: a downstream node receives outputs from all its upstreams
      Given a workflow where the entry feeds two code nodes that each emit {"value": <number>}
      And both code nodes feed a final code node that sums the two "value" fields
      When I POST /go/studio/execute_sync
      Then the response status is 200
      And the result contains the expected sum

  Rule: Streaming endpoint emits the documented event shapes

    @integration
    Scenario: /go/studio/execute streams execution_state_change per node, then done
      Given a workflow with one entry, one code node, and one end node
      When I POST /go/studio/execute and read the SSE stream
      Then I receive at least one "execution_state_change" event per node id
      And I receive a final "done" event with status "success"
      And the connection closes after "done"

    @integration
    Scenario: heartbeat keeps the connection alive during long-running nodes
      Given NLP_STREAM_HEARTBEAT_SECONDS is set to 1
      And a workflow whose only code node sleeps 5 seconds
      When I POST /go/studio/execute and read the SSE stream
      Then I receive at least 4 "is_alive" events before the "done" event

    @integration
    Scenario: idle stream times out and closes
      Given NLP_STREAM_IDLE_TIMEOUT_SECONDS is set to 2
      And a workflow whose code node sleeps 10 seconds and emits no progress
      When I POST /go/studio/execute and read the SSE stream
      Then within 3 seconds I receive an "error" event with payload.message containing "idle_timeout"
      And the connection closes

  Rule: Client cancellation propagates to in-flight nodes

    @integration
    Scenario: closing the connection cancels HTTP-block requests
      Given a workflow whose only HTTP node calls a slow upstream that takes 30 seconds
      When I POST /go/studio/execute, read 2 events, then close the connection
      Then within 1 second the upstream HTTP server observes the connection close
      And the node's final state is "cancelled"

  Rule: Errors from one node fail the workflow with structured details

    @integration
    Scenario: a code-block exception aborts the workflow with the traceback in the event payload
      Given a workflow whose code node raises ZeroDivisionError
      When I POST /go/studio/execute_sync
      Then the response status is 200
      And the result.status is "error"
      And the result.error.node_id is the failing node's id
      And the result.error.message contains "ZeroDivisionError"
      And no downstream nodes were executed

    @integration
    Scenario: a node-level error emitted on the SSE stream does not break the heartbeat
      Given a workflow whose first node fails with a runtime error
      When I POST /go/studio/execute and read the SSE stream
      Then I receive an "execution_state_change" event with the failing node's status set to "error"
      And I then receive a "done" event with status "error"

  Rule: chat_messages history is preserved across node boundaries

    @integration
    Scenario: a multi-turn chat history threads through two LLM nodes intact
      Given a workflow with: entry -> signature_node_a (LLM) -> signature_node_b (LLM)
      And the entry produces chat_messages with 3 prior turns (user, assistant, user)
      When I POST /go/studio/execute_sync
      Then signature_node_a observes 3 input messages plus the system message
      And signature_node_b observes 5 input messages (3 prior + node_a user + node_a assistant)
      And no message role or tool_call payload is dropped

  Rule: Per-node cost and duration are surfaced in the result

    @integration
    Scenario: result includes per-node cost and duration_ms when LLM nodes ran
      Given a workflow with one signature node calling a real model via the gateway
      When I POST /go/studio/execute_sync
      Then result.nodes["<signature_node_id>"].cost is a positive float
      And result.nodes["<signature_node_id>"].duration_ms is a positive integer
      And result.total_cost equals the sum of node costs

  Rule: Workflow execution is byte-equivalent to the Python implementation

    @integration @parity
    Scenario Outline: a fixture workflow produces the same output on Go and Python
      Given the fixture workflow at <fixture_path>
      And the same input <input_path>
      When I POST the input to /go/studio/execute_sync (Go)
      And I POST the same input to /studio/execute_sync (Python)
      Then both responses share the same result.status
      And both responses' deterministic fields are byte-equivalent
      And LLM-derived fields agree to within the documented tolerance

      Examples:
        | fixture_path                                | input_path                                  |
        | tests/fixtures/workflows/simple_dataset.json | tests/fixtures/inputs/simple_dataset.json   |
        | tests/fixtures/workflows/code_only.json      | tests/fixtures/inputs/code_only.json        |
        | tests/fixtures/workflows/http_only.json      | tests/fixtures/inputs/http_only.json        |
        | tests/fixtures/workflows/dag_fanout.json     | tests/fixtures/inputs/dag_fanout.json       |
        | tests/fixtures/workflows/multi_turn_chat.json| tests/fixtures/inputs/multi_turn_chat.json  |
