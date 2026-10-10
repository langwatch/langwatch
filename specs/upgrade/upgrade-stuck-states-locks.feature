# Locks and leases an upgrade waits on (stuck-states review, section C). Each failure here once
# left an upgrade waiting forever or let two runners work at once; each now fails fast or stays honest.
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

  # Confirmed, fix pending a decision (.claude/tmp/handoffs/stuck-states-C.md, C3).
  @unimplemented
  Scenario: A pass that worked no tenant leaves the tenant step pending
    Given a tenant step with eligible tenants and no tenant state yet
    And the tenant lease store is unreachable
    When a pass runs and settles the step
    Then no tenant was worked
    And the step's ledger row stays pending
