Feature: Applying retention to existing data runs in the worker
  The api holds no ClickHouse write credential (ADR-202 Decided 13). Applying a
  retention change to rows already stored, cancelling it and reading its progress
  are commands on data-retention's own pipeline: the api records the request and
  answers once accepted; the worker runs the rewrite on the system identity and
  keeps one progress status per project, which the api reads. One process per
  project wakes itself while its rewrites run; nothing lists projects across
  tenants. The panel refreshes from read hints on the pipeline's facts, never
  from a timer.

  Background:
    Given a project whose resolved traces retention is 30 days
    And a member who holds "project:update" on it

  @unit
  Scenario: Applying to existing data answers once the request is accepted
    When the member applies the traces retention to existing data
    Then the answer names the tables the traces rewrite targets and 30 applied days
    And the request runs no ClickHouse statement
    And a retroactive apply request for the project is recorded

  @unit
  Scenario: An accepted apply shows as applying until the worker starts it
    Given an accepted traces apply the worker has not started
    When the project's progress is read
    Then it shows one traces entry the member can cancel

  @unit
  Scenario: The worker starts the rewrite once and records it as the project's progress
    Given an accepted traces apply
    When the worker handles the apply
    Then the traces rewrite runs on the system identity with 30 days
    And the project's progress lists the mutations the rewrite started
    And the apply no longer shows as waiting

  @unit
  Scenario: A redelivered apply starts no second rewrite
    Given the worker already started the rewrite for an apply
    When the same apply is delivered again
    Then no rewrite statement runs

  @unit
  Scenario: An apply whose rewrite is already running is settled without a second rewrite
    Given the rewrite for an apply is running but its progress was never recorded
    When the same apply is delivered again
    Then no second rewrite runs
    And the project's progress lists the running mutations

  @unit
  Scenario: A failing rewrite is retried, and its last attempt shows the failure
    Given ClickHouse refuses the rewrite
    When the worker handles the apply before its last attempt
    Then the delivery fails so the outbox retries it
    And the apply still shows as applying
    When the last attempt fails
    Then the project's progress shows the traces apply as failed, with a customer-safe message
    And the delivery still fails, so operators see it

  @unit
  Scenario: A failed apply stays on the panel until dismissed or applied again
    Given the worker gave up on a traces apply
    When the member applies the traces retention to existing data again
    Then the failed entry is replaced by the new apply
    Given the worker gave up on that apply too
    When the member cancels the failed entry
    Then the project's progress no longer shows it
    And no ClickHouse statement runs for the dismissal

  @unit
  Scenario: A partly applied apply redelivered issues only the rewrites not yet issued
    Given the worker issued the first of an apply's rewrites and then failed
    When the same apply is delivered again
    Then the remaining rewrites are issued
    And the first rewrite is not issued a second time

  @unit
  Scenario: A second apply while one runs is refused
    Given the project's progress shows a running rewrite
    When the member applies the traces retention to existing data
    Then the request is refused with "data_retention_mutation_in_progress"
    And no apply request is recorded

  @unit
  Scenario: Cancelling answers once the request is accepted
    Given the project's progress shows a running rewrite
    When the member cancels it
    Then the request runs no ClickHouse statement
    And a cancel request for that mutation is recorded
    And the project's progress no longer lists it

  @unit
  Scenario: The worker kills the cancelled mutation, and a redelivery is harmless
    Given a recorded cancel for a running mutation
    When the worker handles the cancel twice
    Then the mutation is killed on the system identity
    And the project's progress is recorded from what ClickHouse still runs

  @unit
  Scenario: Cancelling an apply the worker has not started stops it starting
    Given an accepted traces apply the worker has not started
    When the member cancels it
    And the worker then handles the apply
    Then no rewrite statement runs

  @unit
  Scenario: The progress read answers the worker's status, never system.mutations
    Given the worker recorded two running mutations for the project
    When the project's progress is read
    Then the answer lists those two mutations
    And the read runs no ClickHouse statement

  @unit
  Scenario: Each project's process wakes itself while its rewrites run and stops when they settle
    Given the worker recorded a running rewrite for the project
    Then the project's process arms its next wake
    When the process wakes
    Then it asks for that project's progress only, and arms the next wake
    When a record shows no rewrite running
    Then the process stops waking

  @unit
  Scenario: A progress refresh records the project only when its rewrites moved
    Given the worker recorded a running rewrite for the project
    When the refresh finds the rewrite unchanged
    Then no progress is recorded
    When ClickHouse finishes the rewrite
    Then the refresh records the project's progress without it

  @unit
  Scenario: The progress read answers the share of parts rewritten
    Given the worker recorded a rewrite that started with 4 parts to do
    When ClickHouse has 1 part left and the refresh records it
    Then the progress read answers 75 percent for that rewrite
    And an apply the worker has not started answers 0 percent

  @unit
  Scenario: A redelivered fact never rewinds the progress status
    Given the status applied a newer progress fact
    When an older apply request is delivered again
    Then the status keeps the newer progress

  @unit
  Scenario: The progress read is refreshed by read hints
    Then the progress read declares the apply, cancel and progress facts as what makes it stale

  @integration
  Scenario: The panel shows an apply in flight with its percentage and Cancel
    Given the progress read answers a traces rewrite at 40 percent
    When the member opens the retention panel
    Then the traces card shows "Applying… 40%" with a Cancel action

  @integration
  Scenario: The panel shows a failed apply with its message and Dismiss
    Given the progress read answers a failed traces apply
    When the member opens the retention panel
    Then the traces card shows the failure message with a Dismiss action
