Feature: Adapter observability and worker resilience for scenario runs
  As a LangWatch user running scenarios
  I want failures in serialized agent adapters and the scenario worker to be observable and recoverable
  So that runs never silently disappear, errors are easy to diagnose, and worker restarts do not orphan runs

  # ============================================================================
  # #3438 — SerializedCodeAgentAdapter emits a span on timeout/exception
  # ============================================================================
  # The adapter must always leave a span footprint when its NLP call fails, so
  # observability traces show the failure point instead of stopping at the
  # preceding simulator span.

  @unit
  Scenario: Adapter emits an ERROR span when the NLP fetch fails
    Given a SerializedCodeAgentAdapter pointed at an unreachable NLP service
    When call(input) is invoked
    Then an OTEL span named "SerializedCodeAgentAdapter.execute_nlp_request" is emitted
    And the span status is ERROR
    And the span attribute "error.kind" is "network"
    And an exception is recorded on the span

  @unit
  Scenario: Adapter emits an ERROR span with kind=timeout when the request aborts
    Given a SerializedCodeAgentAdapter whose NLP request times out
    When call(input) is invoked
    Then an OTEL span named "SerializedCodeAgentAdapter.execute_nlp_request" is emitted
    And the span status is ERROR
    And the span attribute "error.kind" is "timeout"

  @unit
  Scenario: Adapter emits an ERROR span with kind=http when NLP returns 500
    Given a SerializedCodeAgentAdapter whose NLP service returns 500 with a user-code traceback
    When call(input) is invoked
    Then an OTEL span named "SerializedCodeAgentAdapter.execute_nlp_request" is emitted
    And the span status is ERROR
    And the span attribute "error.kind" is "user_code"
    And the span attribute "http.status_code" is 500

  @unit
  Scenario: Adapter closes the span on a successful run
    Given a SerializedCodeAgentAdapter whose NLP service returns a successful response
    When call(input) is invoked
    Then an OTEL span named "SerializedCodeAgentAdapter.execute_nlp_request" is emitted
    And the span status is OK
    And the span attribute "http.status_code" is 200

  # ============================================================================
  # #3439 — Clearer Python error surface (adapter vs user code, HTTP context)
  # ============================================================================
  # When an HTTP 500 comes back from the NLP service with a user-code error,
  # the message should be labelled as user code, not generic adapter chatter.

  @unit
  Scenario: HTTP 500 with user-visible detail is labelled as user code
    Given the NLP service returns HTTP 500 with detail "Traceback (most recent call last)..."
    When the SerializedCodeAgentAdapter wraps the failure
    Then the thrown Error message starts with "[user code]"
    And the message includes the truncated traceback

  @unit
  Scenario: Adapter-side errors are labelled as adapter failures
    Given the NLP service is unreachable
    When the SerializedCodeAgentAdapter wraps the failure
    Then the thrown Error message starts with "[adapter]"
    And the message includes the target URL

  @unit
  Scenario: Unrelated AI SDK warnings are stripped from the surfaced message
    Given the NLP service returns HTTP 500 with detail containing an AI SDK compat-mode warning followed by the real Python traceback
    When the SerializedCodeAgentAdapter wraps the failure
    Then the thrown Error message excludes the "AI SDK Warning" line
    And the message preserves the Python traceback

  # ============================================================================
  # #3198 — Workflow without an END node fails with HTTP 400, not 500
  # ============================================================================

  @unit
  Scenario: Workflow without an END node returns 400 from /execute_sync
    Given a workflow payload whose nodes list contains no node of type "end"
    When the workflow is validated
    Then a ClientReadableValueError is raised with message containing "End node"
    And the message names the missing component clearly

  @unit
  Scenario: Workflow whose END node has no inbound edges returns 400 from /execute_sync
    Given a workflow payload with an end node that has no inbound edges
    When the workflow is validated
    Then a ClientReadableValueError is raised with message containing "End node has no wired inputs"

  @unit
  Scenario: Happy path still validates a fully wired workflow
    Given a workflow with entry -> code -> end and edges wired through
    When the workflow is validated
    Then no error is raised

  # ============================================================================
  # #3195 + #3365 — Drain-with-emit so worker restarts do not orphan runs
  # ============================================================================
  # When the scenario worker drains (maxRuntime restart, deploy, OOM), any
  # running or pending jobs must emit a terminal failed event so the UI
  # transitions out of QUEUED/STARTING instead of spinning forever.

  @unit
  Scenario: Pool.drain emits a failure callback for every running job
    Given the execution pool has 2 running jobs
    And drain() is configured with an onDrain callback
    When drain() is called
    Then each running child receives SIGTERM
    And the onDrain callback is invoked once per running job with reason "worker_drain"

  @unit
  Scenario: Pool.drain emits a failure callback for every pending job
    Given the execution pool has 1 running job and 2 pending jobs
    And drain() is configured with an onDrain callback
    When drain() is called
    Then the onDrain callback is invoked once per pending job with reason "worker_drain"
    And the pending queue is empty after drain

  @unit
  Scenario: Scenario processor close wires drain to the failure handler
    Given the scenario processor was started with a stub failure handler
    When the processor's close() method is invoked
    Then the pool is drained
    And the stub failure handler receives one ensureFailureEventsEmitted call per affected run
    And each call carries an error message naming worker_drain as the cause

  # ============================================================================
  # #3197 — Judge evaluates against Criteria only, not Situation
  # ============================================================================

  @unit
  Scenario: Criteria-only judge system prompt excludes the scenario description
    Given a scenario with situation "Customer is angry about delayed delivery" and criteria ["Agent apologises", "Agent offers refund"]
    When buildCriteriaOnlyJudgePrompt is called with the criteria list
    Then the returned prompt contains both criteria
    And the returned prompt does NOT contain the situation text

  @unit
  Scenario: RemoteSpanJudgeAgent delegates with a criteria-only system prompt
    Given a RemoteSpanJudgeAgent constructed with criteria ["Agent apologises"]
    When call(input) is invoked
    Then judgeAgent is delegated to with a non-empty systemPrompt
    And the delegated systemPrompt is the criteria-only prompt
