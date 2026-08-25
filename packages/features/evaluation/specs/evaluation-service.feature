Feature: Evaluation service boundary

  Scenario: Evaluation execution is delegated through one capability
    Given a valid trace evaluation command
    When the Evaluation service executes it
    Then it validates workflow scope through the Workflow service when needed
    And delegates trace and evaluator execution to the injected execution port

  Scenario: Evaluation runs use private ClickHouse persistence
    Given an evaluation run value
    When the Evaluation service upserts it
    Then it validates the Zod 4 run contract
    And writes through its private repository

  Scenario: Per-trace evaluation reads use the same capability
    Given trace evaluation cards need evaluation state or deferred inputs
    When the Evaluation service reads them
    Then it uses its private repository
    And a memory-limited trace read retries without the heavy Inputs column

  Scenario: Monitor performance uses the same capability
    Given monitors need current and previous evaluation performance
    When the Evaluation service reads their performance
    Then it uses its private performance read model
    And it chooses score or pass-rate based on each monitor's guardrail mode

  Scenario: Missing evaluation runs throw a domain error
    Given no run exists for an evaluation id
    When a caller requests that run
    Then EvaluationNotFoundError is thrown

  Scenario: API and workers share the same service
    Given the process has composed one Evaluation service
    When an API handler or worker reads a run
    Then both use the same service capability
    And neither constructs ClickHouse or execution dependencies per request
