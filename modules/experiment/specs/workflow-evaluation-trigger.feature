Feature: A workflow evaluation is requested by the api and run by the worker
  The api refuses what it can see at once, registers the run for polling and
  sends the request on experiment_run_processing; the worker prepares and plans
  it and starts it on the run's pipeline, or completes it failed.
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
    Then it skips the request, starting nothing and failing nothing

  @unit
  Scenario: The worker starts a requested evaluation on the run's pipeline with its plan
    Given a registered request for a workflow with a committed version
    When the worker receives it
    Then it starts the run under the same id with a plan of one cell per row
    And the plan names the experiment's slug and the run's link for the poller

  @unit
  Scenario: A requested evaluation the worker cannot prepare completes failed with its code
    Given a registered request for a workflow with no committed version
    When the worker receives it
    Then the run is completed failed carrying the refusal
    And no run is started
    And the poller reads it failed with the refusal's code and the requested total
