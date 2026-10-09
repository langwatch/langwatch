Feature: seed:apply applies seedgen's actions through installed module APIs
  The seedgen runner is a task plugin loaded by LANGWATCH_TASK_MODULES. It reads
  seedgen's NDJSON actions on stdin, calls one installed module API operation per
  action kind in the tasks process, and writes one reply line per action on stdout.
  The stack's real worker runs every command those operations send.
  Design: dev/docs/plans/seed-2026-10-09.md sections 2, 3.1 and 14 (lane SG3).

  @unit
  Scenario: The seed:apply task loads by LANGWATCH_TASK_MODULES
    Given LANGWATCH_TASK_MODULES names @langwatch/seedgen-runner
    When the tasks process loads its plugin modules
    Then createTasks receives the booted App and returns the seed:apply task

  @unit
  Scenario: The runner reads and writes the protocol seedgen speaks
    Given the protocol fixtures in tools/seedgen/testdata/protocol written from seedgen's Go structs
    When the runner parses each action and reply line
    Then every line round-trips through the runner's schemas unchanged

  @unit
  Scenario: Each action kind calls its one module API operation
    When seedgen sends grant.attach, retention.set, trace.otlp, log.otlp and metric.otlp actions
    Then grants are attached through the authz API as the system caller, skipping held ones
    And retention is set through the data-retention API for every category of the organization
    And each telemetry export goes to its owner's batched ingest operation for the action's project
    And every action is acknowledged with its id

  @unit
  Scenario: An acknowledged grant returns its minted id as a reference
    When a grant.attach action naming a ref is applied
    Then the reply carries a reference for each grant that was attached and none for a held one

  @unit
  Scenario: A product refusal becomes a refusal line with its code
    Given a module API operation refuses with a handled error
    When the action is applied
    Then the reply is a refusal carrying the error's code and whether it is retryable
    And the run continues with the next action

  @unit
  Scenario: Telemetry the ingest queue could not take is refused as retryable
    Given a telemetry export whose ingestion failed or whose store was unavailable
    When the action is applied
    Then the reply is a retryable refusal

  @unit
  Scenario: An unknown kind or malformed input is refused without calling any API
    When seedgen sends an action of an unknown kind, or one missing its organization or project
    Then the reply is a refusal that is not retryable
    And no module API operation is called

  @unit
  Scenario: A line that is not a seed action stops the run naming the line
    When seedgen sends a line that is not a seed action, or one carrying an unresolved $ref
    Then the task fails naming the line number

  @unit
  Scenario: At most the configured number of actions are applied at once
    When seed:apply runs with --concurrency 2 and five slow actions
    Then no more than two module API calls are in flight at any moment
    And every action is acknowledged
