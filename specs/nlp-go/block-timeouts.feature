# Every block that reaches an outside system takes its wall-clock budget from
# one operator knob under the `NLPGO_ENGINE_` prefix. A workflow node may name
# its own `timeout_ms`, but that number is a request for a SHORTER budget: it
# can never buy more than the deployment allows. The code block already works
# this way (specs/nlp-go/code-block.feature); this file pins the same rule for
# the three sibling blocks, so no caller can reach a `context.WithTimeout` that
# the operator has not bounded — plus the overflow edge, which all four share.
Feature: Block timeouts — a node may ask for less than the operator's ceiling, never more

  Rule: The HTTP block clamps a node's timeout_ms to the operator's ceiling

    @unit
    Scenario: An HTTP node's timeout_ms cannot exceed the operator's ceiling
      Given the HTTP block's configured timeout is 200 milliseconds
      And an HTTP node asking for 30000 milliseconds against an endpoint that never answers
      When the executor runs the request
      Then the call is abandoned within 3 seconds
      And the error reports a deadline exceeded

    @unit
    Scenario: An HTTP node's timeout_ms below the ceiling is honored
      Given the HTTP block's configured timeout is 30 seconds
      And an HTTP node asking for 200 milliseconds against an endpoint that never answers
      When the executor runs the request
      Then the call is abandoned within 3 seconds

    @unit
    Scenario: A missing HTTP timeout_ms falls back to the operator's ceiling
      Given the HTTP block's configured timeout is 200 milliseconds
      And an HTTP node declaring no timeout_ms against an endpoint that never answers
      When the executor runs the request
      Then the call is abandoned within 3 seconds

  Rule: The agent sub-workflow runner clamps a node's timeout_ms to the operator's ceiling

    @unit
    Scenario: An agent sub-workflow timeout_ms cannot exceed the operator's ceiling
      Given the agent workflow runner's configured timeout is 200 milliseconds
      And a sub-workflow call asking for 30000 milliseconds against an endpoint that never answers
      When the runner executes the call
      Then the call is abandoned within 3 seconds
      And the error reports a deadline exceeded

  Rule: The evaluator block clamps a node's timeout_ms to the operator's ceiling

    @unit
    Scenario: An evaluator timeout_ms cannot exceed the operator's ceiling
      Given the evaluator block's configured timeout is 200 milliseconds
      And an evaluator call asking for 30000 milliseconds against an endpoint that never answers
      When the executor runs the request
      Then the call is abandoned within 3 seconds
      And the error reports a deadline exceeded

  Rule: Each ceiling is an operator knob under the NLPGO_ENGINE_ prefix

    @unit
    Scenario: The HTTP block ceiling comes from NLPGO_ENGINE_HTTP_BLOCK_TIMEOUT_SECONDS
      Given NLPGO_ENGINE_HTTP_BLOCK_TIMEOUT_SECONDS is 300
      When the service wires the HTTP block executor
      Then the executor's ceiling is 5 minutes

    @unit
    Scenario: The agent sub-workflow ceiling comes from NLPGO_ENGINE_AGENT_WORKFLOW_TIMEOUT_SECONDS
      Given NLPGO_ENGINE_AGENT_WORKFLOW_TIMEOUT_SECONDS is 300
      When the service wires the agent workflow runner
      Then the runner's ceiling is 5 minutes

    @unit
    Scenario: The evaluator ceiling comes from NLPGO_ENGINE_EVALUATOR_TIMEOUT_SECONDS
      Given NLPGO_ENGINE_EVALUATOR_TIMEOUT_SECONDS is 300
      When the service wires the evaluator executor
      Then the executor's ceiling is 5 minutes

    @unit
    Scenario: An unset block-timeout knob keeps today's twelve-minute default
      Given none of the block timeout knobs are set
      When the service wires the HTTP, agent workflow and evaluator executors
      Then every ceiling is 12 minutes

    @unit
    Scenario: A negative block-timeout knob keeps today's twelve-minute default rather than expiring
      Given every block timeout knob is set to -30 seconds
      When the service wires the HTTP, agent workflow and evaluator executors
      Then every ceiling is 12 minutes

  Rule: A timeout_ms too large to convert falls back to the ceiling, never to an instant failure

    A millisecond count above roughly 9.2e12 overflows int64 when converted to
    a nanosecond duration and wraps NEGATIVE. A negative budget reads as
    "shorter than the ceiling" and expires the call before it is sent, which
    would invert the rule above: the largest numbers a node can write would be
    the ones that fail fastest.

    @unit
    Scenario: An HTTP node's overflowing timeout_ms falls back to the operator's ceiling
      Given the HTTP block's configured timeout is 200 milliseconds
      And an HTTP node asking for more milliseconds than a duration can hold, against an endpoint that never answers
      When the executor runs the request
      Then the call is abandoned no sooner than the configured 200 milliseconds
      And the error reports a deadline exceeded

    @unit
    Scenario: An agent sub-workflow's overflowing timeout_ms falls back to the operator's ceiling
      Given the agent workflow runner's configured timeout is 200 milliseconds
      And a sub-workflow call asking for more milliseconds than a duration can hold, against an endpoint that never answers
      When the runner executes the call
      Then the call is abandoned no sooner than the configured 200 milliseconds
      And the error reports a deadline exceeded

    @unit
    Scenario: An evaluator's overflowing timeout_ms falls back to the operator's ceiling
      Given the evaluator block's configured timeout is 200 milliseconds
      And an evaluator call asking for more milliseconds than a duration can hold, against an endpoint that never answers
      When the executor runs the request
      Then the call is abandoned no sooner than the configured 200 milliseconds
      And the error reports a deadline exceeded

    @unit
    Scenario: A code node's overflowing timeout_ms falls back to the operator's ceiling
      Given a code node asking for more milliseconds than a duration can hold
      When the engine reads the node's timeout_ms
      Then it reads as no request at all, leaving the operator's ceiling in charge
