Feature: A scenario canary health check that fires a real run and says what broke

  GET /api/health/scenarios exists for an external monitor, not a person. It
  queues a real scenario run in a dedicated canary project through the same
  queue path `simulationRunnerRouter.run` uses (`getApp().simulations.queueRun`),
  blocks until the run is both terminal AND judged, and answers with a shape a
  monitor can alert on: 200 when the run passed, 503 with a named `reason` when
  it did not, 429 when a canary is already in flight.

  Three unhealthy reasons exist, and only three: `timeout` (no terminal status
  within budget), `run_failed` (a terminal failure status, or a judge verdict of
  FAILURE/INCONCLUSIVE), and `judge_failed` (the run finished but no judge
  verdict came back — no results, an error on results, or a missing verdict).
  A first unhealthy outcome is retried exactly once, because a single LLM run
  is noisy; total wall time stays under 120s inclusive of that retry, with each
  attempt capped at 55s. The 120s is a real deadline, not a hope: it is threaded
  into every attempt and the retry is abandoned once the budget is spent, so
  unbounded launch or database latency cannot run past it, and a boundary await
  that never returns (a wedged datastore, a hung launch) is bounded by a real
  timer so it reports `timeout` rather than wedging the probe busy-forever. On a
  timeout the run itself is left alone — there is no cancel command, and the
  stall watchdog already reaps a stuck run to terminal ERROR, so nothing is
  orphaned by walking away from it.

  The scenario and target the canary runs are not server-side config: they are
  named per request by a `?runPlanId=<SimulationSuite id>` query parameter,
  pointing at a run plan (a suite with kind `run_plan`) that holds exactly one
  scenario and exactly one target. The plan's own row supplies the project, so
  nothing else on the request can redirect the run. A request with no runPlanId
  is a bad request (400) — distinct from a plan that does not resolve. A run
  that cannot even be launched — the launcher throws, or the named run plan is
  not found, or it does not hold exactly one scenario and one target — is
  `run_failed`, reported inside the same 200/503/429 contract rather than
  escaping as a raw 500. The run plan is validated up front, before any run is
  queued.

  Auth is the shared `CRON_API_KEY` secret (`validateInternalSecret`), checked
  before any run is queued: a status-page poller has no user session and no
  project API key, only this one shared secret. The route is declared as an
  internal-secret endpoint, so the generated OpenAPI spec never advertises this
  LLM-spend endpoint as needing no auth. A second request for the same run plan
  arriving while its canary is already running starts no second LLM run — it is
  told the probe is busy; the guard is keyed per run plan, so two monitors
  probing two different plans never block each other. Every response carries
  `Cache-Control: no-store`, so a monitor always sees the current run's result
  rather than a cached one.

  # Bindings:
  #   platform/app/src/server/health-probes/scenario-canary.service.ts
  #   platform/app/src/server/health-probes/__tests__/scenario-canary.service.unit.test.ts
  #   platform/app/src/server/routes/health-checks.ts
  #   platform/app/src/server/routes/__tests__/scenario-canary.integration.test.ts

  @unit
  Scenario: A run that finishes and is judged a success is healthy
    Given a scenario run that reaches terminal SUCCESS
    And the judge returns a SUCCESS verdict
    When the outcome is classified
    Then the outcome is healthy

  @unit
  Scenario: A run that finishes with no judge verdict is judge_failed
    Given a scenario run that reaches a terminal status
    And no judge verdict comes back for it
    When the outcome is classified
    Then the outcome is unhealthy with reason "judge_failed"

  @unit
  Scenario: A run that terminates in a failure status is run_failed
    Given a scenario run that reaches terminal ERROR, FAILED, CANCELLED or STALLED
    When the outcome is classified
    Then the outcome is unhealthy with reason "run_failed"

  @unit
  Scenario: A run the judge marks FAILURE or INCONCLUSIVE is run_failed
    Given a scenario run that reaches terminal SUCCESS
    And the judge returns a FAILURE or INCONCLUSIVE verdict
    When the outcome is classified
    Then the outcome is unhealthy with reason "run_failed"

  @unit
  Scenario: A run that never reaches terminal within budget times out without being cancelled
    Given an upstream that never reports a terminal status
    When the probe runs the canary
    Then the probe returns within the 120 second total budget
    And the outcome is unhealthy with reason "timeout"
    And no cancel command is issued for the run

  @unit
  Scenario: A first unhealthy outcome is retried once and a healthy retry reports healthy
    Given the first attempt is unhealthy
    And the second attempt is healthy
    When the probe runs the canary
    Then the outcome is healthy
    And exactly two runs were queued

  @unit
  Scenario: A healthy first outcome is never retried
    Given the first attempt is healthy
    When the probe runs the canary
    Then the outcome is healthy
    And exactly one run was queued

  @unit
  Scenario: A concurrent canary while one is in flight starts no second run
    Given a canary run already in flight
    When a second canary is requested concurrently
    Then the second request is told the probe is busy
    And exactly one run was queued

  @unit
  Scenario: The canary run uses the model configured on the canary scenario
    Given the canary scenario is queued with no model override
    When the probe runs the canary
    Then the queued run carries no model override
    And the run inherits the model configured on the canary scenario record

  @integration
  Scenario: A request with no auth secret is refused before any run is queued
    Given the request carries no Authorization header
    When the scenario canary endpoint is called
    Then the response is 401
    And no scenario run is queued

  @integration
  Scenario: A request with the wrong auth secret is refused before any run is queued
    Given the request carries a bearer token that does not match the configured secret
    When the scenario canary endpoint is called
    Then the response is 403
    And no scenario run is queued

  @integration
  Scenario: An authenticated request triggers a real run through the shared queue path
    Given a request carrying the correct internal secret
    When the scenario canary endpoint is called
    Then the run is queued through the same queue path simulationRunnerRouter.run uses
    And the response is 200 with the queued scenarioRunId

  @integration
  Scenario: Canary runs are confined to the run plan's own project regardless of caller input
    Given a request carrying the correct internal secret and a runPlanId
    When the scenario canary endpoint is called
    Then the run is queued against the project id held on that run plan
    And that project id is never taken from any other value on the caller's request

  @unit
  Scenario: The probe abandons the retry once the total budget is spent
    Given a first attempt whose launch latency spends the whole 120s budget
    When the probe runs the canary
    Then the outcome is unhealthy with reason "timeout"
    And no second run is queued
    And the probe returns within the 120 second total budget

  @unit
  Scenario: A wedged datastore times out and releases the in-flight lock
    Given a boundary read that never returns
    When the probe runs the canary
    Then the probe returns unhealthy with reason "timeout" rather than hanging
    And the in-flight lock is released so the next call is not told the probe is busy

  @unit
  Scenario: A launch-time failure is reported as unhealthy run_failed, not a raw error
    Given the launcher throws before a run is queued
    When the probe runs the canary
    Then the outcome is unhealthy with reason "run_failed"
    And no raw error escapes the documented contract

  @unit
  Scenario: A misconfigured run plan reports unhealthy without launching a run
    Given a run plan that is missing, or does not hold exactly one scenario and one target, or names an unknown target type
    When the run plan is validated
    Then the run plan is rejected before any run is launched

  @integration
  Scenario: A request with no runPlanId is a bad request
    Given a request carrying the correct internal secret but no runPlanId
    When the scenario canary endpoint is called
    Then the response is 400
    And no scenario run is queued

  @integration
  Scenario: The scenario canary route is declared internal-secret, never public
    Given the scenario canary route gates in-handler on the internal secret
    When its registered access policy is read
    Then the policy is declared internal-secret, not a public endpoint

  @unit
  Scenario: An archived run plan is rejected without launching a run
    Given a runPlanId naming an archived but otherwise valid one-scenario one-target run plan
    When the run plan is resolved
    Then the run plan is rejected before any run is launched
    And the outcome is unhealthy with reason "run_failed"

  @unit
  Scenario: A suite that is not a run plan is rejected without launching a run
    Given a runPlanId naming a suite whose kind is not run_plan
    When the run plan is resolved
    Then the run plan is rejected before any run is launched
    And the outcome is unhealthy with reason "run_failed"

  @unit
  Scenario: Two concurrent canaries for different run plans both start a run
    Given a canary already in flight for one run plan
    When a second canary is requested for a different run plan
    Then both runs are started
    And neither request is told the probe is busy

  @integration
  Scenario: A blank runPlanId is a bad request
    Given a request carrying the correct internal secret and a blank or whitespace-only runPlanId
    When the scenario canary endpoint is called
    Then the response is 400
    And no scenario run is queued

  @integration
  Scenario: Canary responses are never cacheable
    Given a request carrying the correct internal secret
    When the scenario canary endpoint returns any response
    Then the response carries Cache-Control no-store
