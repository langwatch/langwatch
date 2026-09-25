Feature: A workflow evaluation is requested by the api and run by the worker
  The api refuses what it can see at once, registers the run for polling and
  sends the request on experiment_run_processing; the worker runs it.
  See specs/workflows/evaluate-via-api.feature for the public contract.

  @unit
  Scenario: The evaluation runs on the worker under the run id it answered with
    Given a workflow with a committed version
    When an evaluation is triggered
    Then the run is registered for polling
    And the request is sent to the worker under the same run id

  @unit
  Scenario: Rows beyond the plan's bound are refused before a run starts
    Given a plan that allows one row per run
    When an evaluation is triggered with two inline rows
    Then it is refused with experiment_evaluation_too_many_rows
    And nothing is sent to the worker

  @unit
  Scenario: A redelivered evaluation request does not run twice
    Given a requested evaluation whose run already completed
    When the worker receives the request again
    Then it skips the request and records no failure

  @unit
  Scenario: A worker without a run loop fails the run it was sent
    Given a worker that composed no run loop
    When it receives an evaluation request
    Then the run is recorded as failed for the poller to read
