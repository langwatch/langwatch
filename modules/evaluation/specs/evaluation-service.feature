Feature: Evaluation service boundary

  @unit
  Scenario: Evaluation execution is delegated through one capability
    Given a valid trace evaluation command
    When the Evaluation service executes it
    Then it validates workflow scope through the Workflow service when needed
    And delegates trace and evaluator execution to the injected execution port

  @unit
  Scenario: Evaluation runs use private ClickHouse persistence
    Given an evaluation run value
    When the Evaluation service upserts it
    Then it validates the Zod 4 run contract
    And writes through its private repository

  @unit
  Scenario: Per-trace evaluation reads use the same capability
    Given trace evaluation cards need evaluation state or deferred inputs
    When the Evaluation service reads them
    Then it uses its private repository
    And a memory-limited trace read retries without the heavy Inputs column
    And durable input markers are resolved before the value leaves the service

  @unit
  Scenario: Monitor performance uses the same capability
    Given monitors need current and previous evaluation performance
    When the Evaluation service reads their performance
    Then it uses its private performance read model
    And it chooses score or pass-rate based on each monitor's guardrail mode

  @unit
  Scenario: Missing evaluation runs throw a domain error
    Given no run exists for an evaluation id
    When a caller requests that run
    Then EvaluationNotFoundError is thrown

  Scenario: API and workers share the same service
    Given the process has composed one Evaluation service
    When an API handler or worker reads a run
    Then both use the same service capability
    And neither constructs ClickHouse or execution dependencies per request

  @unit
  Scenario: The evaluation transport moves without changing who may call it
    Given the evaluation procedures are owned by the Evaluation package
    When the process mounts them on its own tRPC root
    Then the browser calls the same procedure names as before
    And every procedure declares the same access decision it declared before

  @unit
  Scenario: An evaluator run reports its duration and its outcome
    Given a process composed the evaluator runtime's telemetry
    When an evaluation finishes
    Then its duration is recorded against the evaluator that produced it
    And its outcome is counted apart from the other outcomes

  @unit
  Scenario: The evaluator inventory names what this install and this project lack
    Given an evaluator this install left out and a project with no Azure Safety provider
    When a caller lists the evaluators
    Then each Azure evaluator names both Azure credentials as missing
    And the evaluator left out says so, apart from being unconfigured
    And every other evaluator's missing variables come from this install's environment

  @unit
  Scenario: A re-scored trace is reported onto the pipeline every other verdict travels on
    Given a caller re-scores one stored trace with one evaluator
    When the evaluator answers
    Then the result reaches the caller
    And the run is attributed to the caller
    And the verdict is reported against the project's tenant
    And a pipeline that refuses the report still lets the caller have the result

  @unit
  Scenario: A warm-up is a nudge rather than a health check
    Given a caller warms the evaluator runtime for a project
    When every probe fails
    Then the caller is still told how many were sent

  @unit
  Scenario: The memory and Postgres evaluation cost ledgers answer alike
    Given one evaluation run's cost written under its own idempotency key
    When the same run is recorded again
    Then the second write is refused rather than billing the project twice
    And a row belonging to another project is never read back for this one
