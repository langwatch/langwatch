# Cloud's automatic upgrade path: dev/docs/plans/migrations-blitz-2026-10-06.md
# sections 3.1 and 3.3, deltas D1, D2 and D8; ADR-173 (upgrades run on deploy).
#
# Cloud ships by gradual release, not by version (Alex, 2026-10-06, night, third),
# so old and new builds serve side by side for as long as a rollout takes. Each
# serving process (api, worker) reports its presence: process id, role, image,
# release (none on a git-<sha> cloud image) and the ids of the steps its image
# declares. A row not refreshed within the stale bound is dead. "Old writers gone
# for step S" is true when every live process declares S. The database clock
# stamps and judges every row, so no process clock enters the answer. That predicate replaces
# the operator-typed writer generation of today's drain assertion; nothing in it
# branches on cloud or orders builds.
#
# The presence table is _langwatch_upgrade_presence, written by the ledger
# repository (mig-ledger-widen). The boot seam that records presence is
# mig-serving-gate's. The deploy contract is dev/docs/runbooks/upgrade-on-deploy.md.

Feature: Cloud upgrades run on deploy while old and new builds serve side by side
  As the platform running a gradual cloud rollout
  I want to know which builds are still serving and which steps each declares
  So that a background step needing every old writer gone finishes only when it is safe

  Background:
    Given a presence with a stale bound of 60 seconds and a refresh every 15 seconds

  @unit
  Scenario: A new process is live
    When a worker records its presence with image "git-abc1234" declaring step "trace:backfill-cost"
    Then the live processes are that worker, with its role, image and declared steps

  @unit
  Scenario: A process not refreshed within the stale bound is not live
    Given a worker recorded its presence
    When more than 60 seconds pass without a refresh
    Then no process is live

  @unit
  Scenario: A process that keeps refreshing stays live past the stale bound
    Given a worker recorded its presence
    When 5 minutes pass and the presence refreshes on its interval
    Then the worker is still live

  @unit
  Scenario: Old writers are gone only when every live process declares the step
    Given an api on the old image declaring no steps is live
    And a worker on the new image declaring step "trace:backfill-cost" is live
    Then old writers are not gone for step "trace:backfill-cost"
    When the api on the old image stops
    Then old writers are gone for step "trace:backfill-cost"

  @unit
  Scenario: A crashed old process stops holding a step back once its row is stale
    Given an api on the old image declaring no steps recorded its presence and then crashed
    And a worker on the new image declaring step "trace:backfill-cost" keeps refreshing
    When more than 60 seconds pass
    Then old writers are gone for step "trace:backfill-cost"

  @unit
  Scenario: Old writers are gone when no process is live
    Given no process has recorded its presence
    Then old writers are gone for step "trace:backfill-cost"

  @unit
  Scenario: A rollback to an image without the step makes old writers present again
    Given a worker on the new image declaring step "trace:backfill-cost" is live
    And old writers are gone for step "trace:backfill-cost"
    When a worker on the rolled-back image declaring no steps records its presence
    Then old writers are not gone for step "trace:backfill-cost"

  @unit
  Scenario: A gracefully stopped process is no longer live
    Given a worker recorded its presence
    When the worker stops
    Then no process is live

  @unit
  Scenario: A stop whose delete fails still stops, and the row lapses at the stale bound
    Given a worker recorded its presence
    And the ledger refuses to delete presence rows
    When the worker stops
    Then the stop completes without an error
    And after more than 60 seconds no process is live

  @unit
  Scenario: A refresh in flight when the process stops does not bring it back
    Given a worker recorded its presence
    And a refresh is in flight
    When the worker stops
    Then no process is live once the refresh has settled

  @unit
  Scenario: A failed refresh is reported and the next interval refreshes again
    Given a worker recorded its presence
    And the ledger refuses the next presence write
    When the refresh interval passes twice
    Then the failure is reported once
    And the worker is live with the later heartbeat

  @unit
  Scenario: A refresh interval not below the stale bound is refused
    When a presence is created with a refresh every 60 seconds and a stale bound of 60 seconds
    Then creating it is refused with a range error

  @unit
  Scenario: A presence without a process id is refused
    When a worker records its presence with an empty process id
    Then recording is refused and nothing is written

  @unit
  Scenario: A process whose first presence write fails is told so
    Given the ledger refuses the next presence write
    When a worker records its presence
    Then recording fails with the ledger's error
    And no refresh is scheduled

  @unimplemented
  Scenario: The deploy runs upgrade from the new image before any Deployment rolls
    Given a cloud deploy of a new image
    When the deploy starts
    Then "pnpm task upgrade" runs from the new image to completion before any Deployment rolls
    And a failed run fails the deploy with no pod rolled

  @unimplemented
  Scenario: A rollback never runs upgrade
    Given a cloud rollback to an earlier image
    When the rollback starts
    Then no upgrade runs and the earlier image serves on the current schema
