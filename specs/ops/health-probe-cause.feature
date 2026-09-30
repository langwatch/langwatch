Feature: An unhealthy health probe names the underlying cause

  GET /api/health/langy and GET /api/health/scenarios answer 503 with a
  `reason` that says which part of the check failed (`turn_failed`,
  `run_failed`, ...). The same reason covers a provider account out of credits,
  a gateway budget cap and a gateway that could not load a key, which need
  different people to act. So an unhealthy answer also carries `cause`: the
  underlying error code, read from the typed error chain (its innermost code)
  or, when the failure arrived as prose, matched against a short list of known
  provider codes. `cause` is a code, never a message: it holds no secrets, no
  URLs and nothing longer than 64 characters. When no code can be read the
  field is left out. `status` and `reason` are unchanged, since monitors key on
  them.

  # Bindings:
  #   platform/app/src/server/health-probes/probe-cause.ts
  #   platform/app/src/server/health-probes/__tests__/probe-cause.unit.test.ts
  #   platform/app/src/server/health-probes/langy-canary.service.ts
  #   platform/app/src/server/health-probes/scenario-canary.service.ts
  #   platform/app/src/server/routes/health-checks.ts

  @unit
  Scenario: A typed error chain reports its innermost code
    Given a Langy turn that failed with langy_agent_errored, caused by llm_upstream_error, caused by insufficient_quota
    When the cause is read
    Then the cause is "insufficient_quota"

  @unit
  Scenario: A chain whose innermost link has no code reports the nearest code above it
    Given an error chain whose innermost reason is an uncoded error
    When the cause is read
    Then the cause is the code of the nearest link that has one

  @unit
  Scenario: A provider message in prose is matched to its code
    Given a scenario run that failed with "AI_RetryError: Failed after 3 attempts. Last error: You have no credits remaining."
    When the cause is read
    Then the cause is "insufficient_quota"

  @unit
  Scenario: A failure with nothing code-shaped in it has no cause
    Given a failure whose message matches no known code and carries no typed code
    When the cause is read
    Then there is no cause

  @unit
  Scenario: A cause is never a message
    Given a typed error whose code is not code-shaped or is longer than 64 characters
    When the cause is read
    Then there is no cause

  @unit
  Scenario: A failed Langy canary turn reports its cause beside its reason
    Given the canary turn settled as failed with a typed error chain ending in insufficient_quota
    When the turn is classified
    Then it is unhealthy with reason "turn_failed" and cause "insufficient_quota"

  @unit
  Scenario: A stopped Langy canary turn reports turn_stopped
    Given the canary turn settled as stopped
    When the turn is classified
    Then it is unhealthy with reason "turn_failed" and cause "turn_stopped"

  @unit
  Scenario: A Langy canary turn that cannot start reports the start error's cause
    Given the turn service throws a typed error with code budget_exceeded when the turn is started
    When the canary runs
    Then it is unhealthy with reason "turn_failed" and cause "budget_exceeded"

  @unit
  Scenario: A failed scenario canary run reports the run error's cause
    Given the canary run terminated in a failure status with an error naming no credits remaining
    When the run is classified
    Then it is unhealthy with reason "run_failed" and cause "insufficient_quota"

  @unit
  Scenario: The Langy probe answers 503 with the cause beside the reason
    Given the canary reports unhealthy with reason "turn_failed" and cause "insufficient_quota"
    When GET /api/health/langy is called with a valid key
    Then the response is 503 with status "unhealthy", reason "turn_failed" and cause "insufficient_quota"

  @unit
  Scenario: The scenario probe answers 503 with the cause beside the reason
    Given the canary reports unhealthy with reason "run_failed" and cause "insufficient_quota"
    When GET /api/health/scenarios is called with a valid key
    Then the response is 503 with status "unhealthy", reason "run_failed" and cause "insufficient_quota"
