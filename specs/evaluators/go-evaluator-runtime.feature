Feature: Evaluators run in the Go evaluator runtime
  As a LangWatch operator
  I want every evaluator served by the Go evaluator runtime instead of the Python service
  So that evaluations need no Lambda and no Python, and keep each tenant's data and traces apart

  # Plan: dev/docs/plans/langevals-go-replacement.md. The request and result
  # shapes stay langevals' ({data, settings, env} in, one result per entry out);
  # only the base URL changes. Behaviour the Python service already promises
  # (specs/evaluators/langevals-*.feature) binds to the Go runtime as each
  # evaluator moves. Every scenario names the level it binds at once built.

  Background:
    Given the evaluator runtime is reachable from the application
    And two projects "acme" and "globex" with different model provider credentials

  # ============================================================================
  # Cut-over
  # ============================================================================

  @integration @unimplemented
  Scenario: An evaluator switched to the Go runtime is answered by it
    Given the "langevals/exact_match" evaluator is switched to the Go runtime
    When "acme" runs it
    Then the result comes from the Go runtime
    And the Python service is not called

  @integration @unimplemented
  Scenario: An evaluator in shadow mode answers from Python and compares with Go
    Given the "langevals/exact_match" evaluator is in shadow mode
    When "acme" runs it
    Then "acme" receives the Python service's result
    And the difference between the two results is recorded
    And the Go runtime's call traces nothing into "acme"'s project

  @integration @unimplemented
  Scenario: Switching an evaluator back is the rollback
    Given the "langevals/exact_match" evaluator was switched to the Go runtime
    When it is switched back to Python
    Then the next run is answered by the Python service

  # ============================================================================
  # Requests the runtime refuses
  # ============================================================================

  @unit @unimplemented
  Scenario: A request without the internal credential is refused
    When a request reaches the evaluator runtime without the internal service credential
    Then it is refused as unauthenticated
    And no evaluator runs

  @unit @unimplemented
  Scenario: An unknown evaluator is refused by name
    When "acme" asks for an evaluator the runtime does not know
    Then the evaluation fails with an "evaluator not found" error

  @unit @unimplemented
  Scenario: Invalid settings are refused before any model call
    When "acme" runs an LLM-judge evaluator with settings its definition rejects
    Then the evaluation fails with an "evaluator settings invalid" error
    And no model call is made

  @unit @unimplemented
  Scenario: A payload over the evaluation cap is refused
    Given an evaluation payload over the evaluation size cap
    When "acme" runs an evaluator on it
    Then the evaluation fails with a "payload too large" error

  # ============================================================================
  # Tenant isolation
  # ============================================================================

  @integration @unimplemented
  Scenario: Concurrent evaluations use only their own tenant's credentials
    When "acme" and "globex" run LLM-judge evaluations at the same time
    Then every model call for "acme" carries only "acme"'s credentials
    And every model call for "globex" carries only "globex"'s credentials

  @unit @unimplemented
  Scenario: The runtime never supplies credentials of its own
    Given the runtime's host has a model provider key configured
    And "acme" sends no credentials for the evaluator's provider
    When "acme" runs an LLM-judge evaluator
    Then the evaluation fails with a "model provider not configured" error
    And no model call is made

  @integration @unimplemented
  Scenario: One tenant's burst does not starve another
    Given "acme" has as many evaluations in flight as one project may
    When "globex" runs an evaluator
    Then "globex"'s evaluation starts without waiting for "acme"'s to finish

  @unit @unimplemented
  Scenario: A project over its limit waits, then is told when to retry
    Given "acme" has as many evaluations in flight as one project may
    And none of them finishes within the wait allowance
    When "acme" runs another evaluator
    Then the evaluation fails with a "busy" error carrying a retry delay

  @unit @unimplemented
  Scenario: A custom provider endpoint cannot reach the internal network
    Given the deployment blocks calls to private addresses
    And "acme"'s custom model provider points at a private address
    When "acme" runs an LLM-judge evaluator
    Then the model call is refused before it leaves the runtime

  # ============================================================================
  # Failures and deadlines
  # ============================================================================

  @unit @unimplemented
  Scenario: A provider failure after a model call is an entry error, not a server error
    Given the judge model fails after the evaluator has already made one model call
    When "acme" runs the evaluator
    Then the entry's result is an error carrying the cost already spent
    And the response is not a server error

  @unit @unimplemented
  Scenario: A rate-limited model call is retried
    Given the judge model answers "rate limited" once and then answers
    When "acme" runs an LLM-judge evaluator
    Then the evaluation reaches a verdict

  @unit @unimplemented
  Scenario: The runtime finishes before the application gives up
    Given a judge model that never answers
    When "acme" runs an LLM-judge evaluator
    Then the entry's result is a deadline error
    And it arrives before the application's own timeout

  # ============================================================================
  # Tracing: the tenant's own calls to them, everything but content to us
  # ============================================================================

  @integration @unimplemented
  Scenario: The evaluator's model calls are traced into the tenant's own project
    Given "acme"'s evaluation request continues a trace
    When "acme" runs an LLM-judge evaluator
    Then "acme"'s project receives an evaluation span with one child span per model call
    And those child spans carry the judge's input and output messages
    And no span from that evaluation reaches "globex"'s project

  @integration @unimplemented
  Scenario: A project id paired with another project's key cannot move spans
    Given "globex"'s evaluations are exporting spans
    When a request names "globex"'s project with "acme"'s key
    Then its spans can only reach "acme"'s project
    And "globex"'s spans keep reaching "globex"'s project

  @unit @unimplemented
  Scenario: An evaluation that continues no trace is not traced
    Given "acme"'s evaluation request continues no trace
    When "acme" runs an LLM-judge evaluator
    Then no span reaches "acme"'s project
    And so the evaluation cannot trigger another evaluation

  @unit @unimplemented
  Scenario: An evaluation without a project key traces nothing to the tenant
    When an evaluation arrives with no project key
    Then the evaluation still runs
    And its tenant spans are dropped and counted

  @unit @unimplemented
  Scenario: LangWatch's own telemetry sees the call but not the content
    Given an entry whose input, output and contexts contain a marker string
    When "acme" runs an LLM-judge evaluator on it
    Then LangWatch's own evaluation span carries the evaluator, model, provider, tokens, cost and status
    And the marker string appears in no span or log line of LangWatch's own telemetry

  @unit @unimplemented
  Scenario: A failed trace export does not fail the evaluation
    Given the tenant's trace endpoint is unreachable
    When "acme" runs an LLM-judge evaluator
    Then the evaluation reaches a verdict

  @unit @unimplemented
  Scenario: Credentials never appear in exported spans
    When "acme" runs an LLM-judge evaluator
    Then no exported span carries a provider credential or the project key

  @integration @unimplemented
  Scenario: Evaluation spans are not billed as ingested spans
    When "acme" runs an LLM-judge evaluator that makes three model calls
    Then "acme" is billed for one evaluation
    And not for the spans the evaluation traced
