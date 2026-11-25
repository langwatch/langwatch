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
    Then grants are attached through the authz API as the action's user, or as the system caller when it names none, skipping held ones
    And retention is set through the data-retention API for every category of the organization
    And each telemetry export goes to its owner's batched ingest operation for the action's project
    And every action is acknowledged with its id

  @unit
  Scenario: Seeded users, orgs, projects and memberships go through the module APIs
    When seedgen sends user.create, org.create, project.create and member.add actions
    Then a user is found by email or created through the user API
    And an org is founded by its owner through the organization API, minting the org and its main team as references
    And a project is created by the owner in the main team through the project API
    And a member is admitted by the owner as a membership row, given its role, then added to the main team
    And anything an earlier run created is found and returned instead of created again
    And a project found rather than created is marked existing, so seedgen sends it no telemetry again

  @unit
  Scenario: A licence org is put on Enterprise through the licensing API
    When seedgen sends a license.issue action for an organization
    Then an Enterprise licence for that organization is signed by licensing with the stack's dev key and stored on it
    And an organization already on a valid Enterprise licence keeps it and nothing is signed
    And a licence licensing rejects is refused, so the org is never counted as Enterprise

  @unit
  Scenario: A trace chunk older than 31 days asks the trace owner's backfill reach
    Given a trace.otlp action whose hour is 90 days ago
    When the action is applied
    Then the export goes to TraceApi.otlpTraces with a backfill reach covering its age
    And a chunk inside 31 days goes with no reach
    And a chunk whose spans the owner dropped is refused, so it is never counted

  @unit
  Scenario: Seeded users share one dev password
    Given seedgen hands the runner the hash of the stack's dev password
    When accepted and invited users are created
    Then each accepted user gets that password and an invited user gets none
    And the password itself never reaches the runner

  @unit
  Scenario: The persona counts haven db seed prints are what it created
    Given a membership the organization holds pending for want of a seat
    When the member.add action is applied
    Then the reply is a refusal, so the member is not counted as created
    And seedgen prints its counts from acknowledged actions only and exits 1 when an identity action was refused

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
  Scenario: A refusal the product marks as temporary is retried
    Given a module API operation refuses with a handled 503, such as an access change its projection has not confirmed
    When the action is applied
    Then the reply is a retryable refusal, so seedgen tries it again

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
