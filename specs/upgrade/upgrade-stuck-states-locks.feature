# Locks and leases an upgrade waits on (stuck-states review, section C). Each failure here once
# left an upgrade waiting forever or let two runners work at once; each now fails fast or stays honest.
# Legacy `pnpm task` runs and `upgrade` share the one timed lease (ARCHITECTURE.md, "No stuck states").
# C4 (old writers gone needs every live roster row to declare the step, a dead row lapses after the
# 10 min stale bound) is by design: dev/docs/ARCHITECTURE.md "Upgrades run on deploy" and
# specs/upgrade/cloud-automatic.feature cover it.

Feature: An upgrade never waits forever on a lock or a lease
  As an operator upgrading LangWatch
  I want every lock the upgrade takes to be bounded and every lease to stay honest
  So that an upgrade either finishes, fails with a reason, or says it is still waiting

  @unit
  Scenario: The lease heartbeat keeps renewing while goose runs
    Given a ClickHouse migration that runs for longer than several heartbeats
    When goose applies it under the upgrade lease
    Then the lease heartbeat keeps firing while goose runs
    And no second runner can take the lease as expired

  @unit
  Scenario: Losing the upgrade lease stops goose
    Given goose is applying a slow ClickHouse migration under the upgrade lease
    When the lease is lost
    Then goose is killed
    And the run fails rather than carrying on as a second schema executor

  @integration
  Scenario: Ledger creation gives up on a held advisory lock instead of waiting forever
    Given another session holds the ledger's advisory lock in an open transaction
    When the runner creates the ledger tables
    Then creation fails with lock_not_available within the lock timeout
    And nothing waits behind it

  @integration
  Scenario: Ledger creation gives up on a held ledger table instead of waiting forever
    Given the ledger exists
    And a long transaction holds a ledger table
    When the runner creates the ledger tables again
    Then creation fails with lock_not_available within the lock timeout
    And reads of that table do not queue behind the runner

  @unit
  Scenario: A pass that worked no tenant leaves the tenant step pending
    Given a tenant step with eligible tenants and no tenant state yet
    And the tenant lease store is unreachable
    When a pass runs and settles the step
    Then no tenant was worked
    And the step's ledger row stays pending

  @unit
  Scenario: A tenant step with an unworked tenant stays pending
    Given a tenant step one of whose eligible tenants has finished
    And another eligible tenant holds no row at all
    When the step is settled
    Then its ledger row stays pending, though no tenant is held or parked

  @unit
  Scenario: A pending tenant step keeps waking passes until it settles
    Given one tenant finished a tenant step earlier
    And the tenant lease store is now unreachable
    When a pass leaves the step pending
    Then the worker's re-drive still asks for another pass
    And once the lease store answers, the next pass settles the step and the re-drive stops asking

  @unit
  Scenario: Legacy tasks refuse while an upgrade holds the lease
    Given an upgrade holds the upgrade lease
    When legacy tasks start and the holder does not finish within the wait
    Then they refuse, naming the upgrade that holds the lease, and run nothing

  @unit
  Scenario: An upgrade refuses while legacy tasks hold the lease
    Given legacy tasks hold the upgrade lease
    When an upgrade asks for the lease
    Then it is refused and told the legacy tasks hold it

  @unit
  Scenario: Upgrade named beside legacy tasks is refused before anything runs
    Given a task invocation naming `upgrade` beside a legacy task
    When it starts
    Then it refuses before taking the lease, because `upgrade` takes the lease itself
