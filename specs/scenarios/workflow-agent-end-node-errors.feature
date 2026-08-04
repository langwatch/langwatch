Feature: Workflow agent surfaces End-node misconfiguration instead of an empty reply
  As someone running a scenario against a workflow agent
  I want a topology mistake in my workflow to come back as a readable error
  So that I can fix the workflow instead of staring at a blank agent turn

  # Context (#3198): a workflow used as a scenario agent that never reaches an
  # End node finishes with `{status: "success", result: {}}`. The scenario then
  # shows an empty agent reply with nothing to act on.
  #
  # Two distinct halves, both of which have to hold for the symptom to be gone:
  #
  #   1. The engine (services/nlpgo) must refuse to finish a full run that can
  #      never produce a result — whether the End node is absent entirely or
  #      present but not wired to anything upstream.
  #   2. The scenario adapter (SerializedWorkflowAgentAdapter) must surface the
  #      engine's error envelope. /go/studio/execute_sync answers 200 with
  #      `{status: "error", error: {...}}` for engine-level failures, so an
  #      adapter that only checks `response.ok` reads the error as a success
  #      with a null result and returns "".
  #
  # Out of scope (tracked separately):
  #   - Automatic best-guess output fallback when no End node exists — the issue
  #     offers it as an alternative to the error, and the error was chosen.

  # ============================================================================
  # AC #1 — topology-invalid workflows are rejected with a specific message
  # ============================================================================

  @unit
  Scenario: A full run with no End node at all is rejected before any node executes
    Given a workflow with an entry node and a code node but no End node
    When the engine plans a full run of that workflow
    Then planning fails with a missing-End-node error
    And the error message says the workflow has no End node

  @unit
  Scenario: A full run whose End node has no wired inputs is rejected
    Given a workflow with an entry node, a code node, and an End node with no inbound edge
    When the engine plans a full run of that workflow
    Then planning fails with an unwired-End-node error
    And the error message says the End node has no wired inputs

  @unit
  Scenario: A full run whose End node is wired only to an unreachable node is rejected
    Given a workflow whose End node is fed by a node that is not reachable from the entry node
    When the engine plans a full run of that workflow
    Then planning fails with an unwired-End-node error

  @unit
  Scenario: A run-until-here plan may legitimately stop before the End node
    Given a workflow with an entry node and a code node but no End node
    When the engine plans a run that stops at the code node
    Then planning succeeds

  @unit
  Scenario: A single-component run may legitimately have no End node
    Given a workflow with an entry node and a code node but no End node
    When the engine plans a single-component run
    Then planning succeeds

  @unit
  Scenario: A single-component run is not rejected for an unwired End node
    Given a workflow with an entry node, a code node, and an End node with no inbound edge
    When the engine plans a single-component run
    Then planning succeeds

  @integration
  Scenario: The execute_sync API answers a workflow with an unwired End node with an error envelope
    Given a workflow with an entry node and an End node that has no inbound edge
    When it is submitted to the execute_sync API as a full run
    Then the response carries an error status
    And the response error message says the End node has no wired inputs

  # ============================================================================
  # AC #1 (defence in depth) — a run never reports an empty success
  # ============================================================================

  @unit
  Scenario: A full run that gets past the checks with no End node still errors
    Given a full run of a workflow with no End node
    When the run completes
    Then the result carries an error status
    And the error says the workflow has no End node

  @unit
  Scenario: A full run whose End node produced no output errors instead of succeeding
    Given a full run whose End node never executed
    When the run completes
    Then the result carries an error status
    And the error says the run never reached its End node

  @unit
  Scenario: A full run takes its result from an End node that did produce output
    Given a full run with two End nodes where only the second one executed
    When the run completes
    Then the result carries a success status
    And the result is the output of the End node that executed

  @unit
  Scenario: A partial run with no End node still succeeds
    Given a partial run of a workflow with no End node
    When the run completes
    Then the result carries a success status

  # A deliberate behaviour change, called out under Deployment Impact on the PR.
  # Neither planner guard can see this shape: the End node IS reachable, so the
  # plan includes it, and only the branch outcome at run time decides it never
  # executes. Erroring is the call — on the surface this issue was filed
  # against, an empty result IS the bug.
  @unit
  Scenario: A full run whose only End node is skipped by an untaken branch errors
    Given a workflow whose only End node is fed by one branch of a condition
    And the condition sends the run down the other branch
    When the workflow runs
    Then the result carries an error status
    And the error says the run never reached its End node

  @unit
  Scenario: A run whose condition reaches its End node still succeeds
    Given a workflow whose only End node is fed by one branch of a condition
    And the condition sends the run down that branch
    When the workflow runs
    Then the result carries a success status

  # The streamed twin of the two scenarios above, and the surface Studio
  # actually watches: a workflow run from the editor reports progress over a
  # stream of state-change frames, not as one return value. That path chose its
  # closing frame by asking "did any node fail?", and a skipped End node fails
  # nothing — so the run announced success with no result and then contradicted
  # itself with a failure, which is the original symptom plus a second one.
  @unit
  Scenario: A streamed run whose only End node is skipped reports the error, not an empty success
    Given a workflow whose only End node is fed by one branch of a condition
    And the condition sends the run down the other branch
    When the workflow runs and its progress is streamed
    Then the closing frames all report the same error status
    And no frame announces a success with no result

  # ============================================================================
  # Not leaking a project secret through the error surface this change opened
  # ============================================================================

  # Making engine errors visible is what turns an unredacted code-node
  # traceback into a customer-visible, persisted string. Code nodes get project
  # secrets as a live `secrets.NAME` namespace, so a raised exception can carry
  # a secret's plaintext — the same hazard the HTTP node already redacts.
  @unit
  Scenario: A code node that raises with a secret in the message does not leak it
    Given a code node whose raised exception embeds a project secret's value
    When the workflow runs
    Then the reported error does not contain the secret's value
    And the reported error shows the value was redacted

  @unit
  Scenario: An if/else condition node that raises with a secret does not leak it
    Given an if/else condition written in Python whose exception embeds a project secret's value
    When the workflow runs
    Then the reported error does not contain the secret's value

  # Redacting only the error left the secret a field next door to escape
  # through: a node's captured output ships in the same response and in every
  # progress event, and printing a secret needs no exception at all.
  @unit
  Scenario: A code node that prints a secret does not leak it through stdout
    Given a code node that prints a project secret's value to stdout and to stderr
    When the workflow runs
    Then the captured output does not contain the secret's value
    And the rest of the captured output is still reported

  # ============================================================================
  # AC #2 — the scenario adapter surfaces the engine's error, never an empty reply
  # ============================================================================

  # These three run the real adapter against a real engine over real HTTP, with
  # nothing stubbed between them. The unit scenarios below stub the engine's
  # response, so they prove the adapter reads an envelope correctly but not
  # that the engine emits the envelope they describe — if the engine ever
  # stopped answering this way, only these would notice.
  @integration
  Scenario: A workflow agent whose End node is unwired reports a readable failure
    Given a workflow agent whose End node has no inbound edge
    When the scenario calls the agent
    Then the agent turn fails
    And the failure names the End node's missing wiring

  @integration
  Scenario: A workflow agent with no End node reports a readable failure
    Given a workflow agent whose workflow has no End node
    When the scenario calls the agent
    Then the agent turn fails
    And the failure says the workflow has no End node

  @integration
  Scenario: A well-formed workflow agent still returns its End node output
    Given a workflow agent whose End node is wired to the entry node
    When the scenario calls the agent
    Then the agent returns the End node's output

  @unit
  Scenario: The workflow agent throws when the engine answers 200 with an error status
    Given the engine answers with HTTP 200 and an error envelope naming the missing End node
    When the workflow agent is called
    Then the agent call throws
    And the thrown error message contains the engine's error message

  @unit
  Scenario: The workflow agent does not return an empty string for an engine error
    Given the engine answers with HTTP 200, an error envelope, and a null result
    When the workflow agent is called
    Then the agent call throws rather than returning an empty string

  @unit
  Scenario: The workflow agent names the engine error type when the envelope carries no message
    Given the engine answers with HTTP 200 and an error envelope with no message
    When the workflow agent is called
    Then the agent call throws
    And the thrown error message contains the engine's error type

  @unit
  Scenario: The workflow agent surfaces the engine error message on a non-2xx response
    Given the engine answers with HTTP 400 and an error envelope naming the missing End node
    When the workflow agent is called
    Then the agent call throws
    And the thrown error message contains the engine's error message

  @unit
  Scenario: A successful engine response is still returned unchanged
    Given the engine answers with HTTP 200, a success status, and a mapped output
    When the workflow agent is called
    Then the agent returns the mapped output

  # --- AC Coverage Map ---
  # Issue #3198 AC #1: "no END node (or an END node with no wired inputs) returns
  #   a 4xx-class response with detail identifying the specific misconfiguration" →
  #   Scenario "A full run with no End node at all is rejected before any node executes"
  #   Scenario "A full run whose End node has no wired inputs is rejected"
  #   Scenario "A full run whose End node is wired only to an unreachable node is rejected"
  #   Scenario "The execute_sync API answers a workflow with an unwired End node with an error envelope"
  #   NOTE ON THE LITERAL STATUS CODE: nlpgo reports engine-level failures as HTTP
  #   200 with `{status: "error", error: {type, message}}`, not as a 4xx. That is
  #   deliberate and is NOT changed here: the herr 4xx envelope
  #   (pkg/herr/http.go toErrorBody) only exposes `Meta["message"]` and renders a
  #   non-herr wrapped cause as `{"type":"unknown","message":"unknown"}`, so moving
  #   these errors to a 400 would DROP the very detail the AC asks for. The 200
  #   envelope carries the message verbatim; AC #2 is what makes it visible.
  # Issue #3198 AC #2: "SerializedWorkflowAgentAdapter surfaces the precheck message
  #   unchanged; no uninterpretable result reaches the user" →
  #   Scenario "A workflow agent whose End node is unwired reports a readable failure"
  #   Scenario "A workflow agent with no End node reports a readable failure"
  #   Scenario "A well-formed workflow agent still returns its End node output"
  #   Scenario "The workflow agent throws when the engine answers 200 with an error status"
  #   Scenario "The workflow agent does not return an empty string for an engine error"
  #   Scenario "The workflow agent names the engine error type when the envelope carries no message"
  #   Scenario "The workflow agent surfaces the engine error message on a non-2xx response"
  # Issue #3198 AC #4: "Happy path unchanged" →
  #   Scenario "A successful engine response is still returned unchanged"
  #   Scenario "A run-until-here plan may legitimately stop before the End node"
  #   Scenario "A single-component run may legitimately have no End node"
  #   Scenario "A single-component run is not rejected for an unwired End node"
  #   Scenario "A partial run with no End node still succeeds"
  #   Scenario "A full run takes its result from an End node that did produce output"
  #   Scenario "A run whose condition reaches its End node still succeeds"
  # BEHAVIOUR CHANGE, not an AC — a full run whose only End node is skipped at
  #   run time by an untaken branch previously returned an empty success and now
  #   errors. Deliberate (an empty result IS the reported bug on this surface),
  #   flagged under Deployment Impact on the PR, and pinned so it stops being an
  #   unstated side effect →
  #   Scenario "A full run whose only End node is skipped by an untaken branch errors"
  #   Scenario "A streamed run whose only End node is skipped reports the error, not an empty success"
  #   The streamed scenario is not a duplicate of the one above it: the two run
  #   through different engine entry points, and only the non-streamed one was
  #   ever covered. The streamed path — the one the workflow editor watches —
  #   still announced an empty success, so AC #1's defence-in-depth half was
  #   absent exactly where the reported symptom is seen.
  # NOT one of #3198's ACs — surfacing engine errors is what makes an unredacted
  #   code-node traceback customer-visible, so the redaction has to land in the
  #   same change or this fix opens a secret-exfiltration path →
  #   Scenario "A code node that raises with a secret in the message does not leak it"
  #   Scenario "An if/else condition node that raises with a secret does not leak it"
  #   Scenario "A code node that prints a secret does not leak it through stdout"
  # Issue #3198 AC #3: "a workflow that runs to completion but where the END node
  #   produces no output for the configured scenarioOutputField returns a 400 with
  #   the existing 'field not found' message rather than a 500" → the BEHAVIOUR is
  #   already implemented and covered by the pre-existing
  #   workflow-agent.adapter.unit.test.ts "scenario output field" tests, which
  #   assert `Scenario output field "X" not found in agent output. Available
  #   fields: ...`. It THROWS rather than returning a 400 — the same status-code
  #   deviation as AC #1, for the same reason, recorded here rather than left
  #   silent. No new scenario added.
