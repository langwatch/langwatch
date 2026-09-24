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

  @unit
  Scenario: An installed evaluation module reads back the runs it wrote
    Given a process that installs the evaluation module over its repositories
    When a run is upserted for a trace
    Then the run reads back by its id, by its trace and among the trace's evaluations
    And a run the tenant never wrote is refused as not found

  @unit
  Scenario: The live tier reads run history through the process's routing ClickHouse
    Given the live evaluation repositories over the process's ClickHouse member
    When a run is looked up for a tenant
    Then every statement names that tenant and carries only settings the member accepts

  @unit
  Scenario: A run lookup without a scheduled time stops at the platform default retention
    Given a process that installs the evaluation module over its repositories
    When a run older than the platform default retention is looked up without its scheduled time
    Then it is refused as not found

  @unit
  Scenario: An evaluation report travels on the pipeline's own sender
    Given an installed evaluation module whose evaluation_processing senders are connected
    When an evaluation is reported
    Then the report is sent once through the reportEvaluation sender

  @unit
  Scenario: An evaluation report refuses by name before the pipeline is connected
    Given an installed evaluation module whose evaluation_processing senders are not connected
    When an evaluation is reported
    Then the report is refused naming the missing reportEvaluation sender

  @unit
  Scenario: Evaluation's fold stores stamp the platform default retention read at write time
    Given evaluation's fold stores built over the platform default retention
    When a run and its analytics fold are written for a tenant with no override
    Then each row carries the default read at that write, and building the stores reads nothing

  @unit
  Scenario: A trigger's evaluation filter matches a processed verdict of the named evaluator
    Given a trace whose evaluator run passed
    When a trigger filtering on that evaluator passing is matched against the trace's runs
    Then the filter matches

  @unit
  Scenario: A verdict on an errored run never satisfies a trigger's evaluation filter
    Given a trace whose evaluator run errored with a failing verdict
    When a trigger filtering on that evaluator failing is matched against the trace's runs
    Then the filter does not match

  @unit
  Scenario: A keyed evaluation filter fails when its evaluator has no run on the trace
    Given a trace with a run for one of two evaluators a trigger names
    When the trigger's evaluation filters are matched against the trace's runs
    Then the filter does not match

  @unit
  Scenario: Topic clustering sends nothing when the deployment names no langevals endpoint
    Given a deployment with no langevals endpoint configured
    When topic clustering asks evaluation for a batch clustering
    Then the answer is not configured
    And nothing is posted to langevals

  @unit
  Scenario: Topic clustering posts a batch to langevals and returns its checked answer
    Given a deployment with a langevals endpoint
    When topic clustering asks evaluation for a batch clustering
    Then the params are posted to the batch clustering route as a topic clustering batch call
    And the answer carries the topics langevals returned

  @unit
  Scenario: A langevals clustering failure is refused with its status and body
    Given langevals answers a clustering call with a server error
    When topic clustering asks evaluation for an incremental clustering
    Then it is refused naming the incremental clustering, the status text and the body

  @unit
  Scenario: A clustering call aborted by its caller does not reach langevals
    Given topic clustering's deadline has already fired
    When it asks evaluation for a batch clustering
    Then the call rejects with the abort and nothing is posted

  @unit
  Scenario: PII detection sends nothing when the deployment names no langevals endpoint
    Given a deployment with no langevals endpoint configured
    When data privacy asks evaluation to detect PII in a batch of texts
    Then the answer is not configured
    And nothing is posted to langevals

  @unit
  Scenario: PII detection posts a batch to langevals' Presidio evaluator and returns one result per text
    Given a deployment with a langevals endpoint
    When data privacy asks evaluation to detect PII in two texts for a set of entities
    Then the texts are posted to the Presidio PII detection route with each entity lowercased and switched on
    And the answer carries one result per text

  @unit
  Scenario: An empty PII batch reaches no langevals
    Given a deployment with a langevals endpoint
    When data privacy asks evaluation to detect PII in no texts
    Then the answer carries no results and nothing is posted

  @unit
  Scenario: A langevals PII detection failure is refused with the answer's body
    Given langevals answers a PII batch with a server error
    When data privacy asks evaluation to detect PII
    Then it is refused carrying the body langevals answered

  @unit
  Scenario: A PII answer that is not one result per text is refused
    Given langevals answers a PII batch of two texts with one result
    When data privacy asks evaluation to detect PII
    Then it is refused naming the expected and received result counts

  @unit
  Scenario: A tenantless PII batch over the staging threshold posts inline
    Given a deployment that stages langevals payloads over a threshold
    When a PII batch that names no project and is over the threshold is posted
    Then it is posted inline and nothing is staged
