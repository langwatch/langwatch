# Cloud's automatic upgrade path: dev/docs/plans/migrations-blitz-2026-10-06.md
# sections 3.1 and 3.3, deltas D1, D2 and D8; ADR-173 (upgrades run on deploy).
#
# Cloud ships by gradual release, not by version (Alex, 2026-10-06, night, third),
# so old and new builds serve side by side for as long as a rollout takes. Each
# serving process (api, worker) reports its roster entry: process id, role, image,
# release (none on a git-<sha> cloud image) and the ids of the steps its image
# declares. A row not refreshed within the stale bound is dead. "Old writers gone
# for step S" is true when every live process declares S. The database clock
# stamps and judges every row, so no process clock enters the answer. That predicate replaces
# the operator-typed writer generation of today's drain assertion; nothing in it
# branches on cloud or orders builds.
#
# The serving roster table is _langwatch_serving_roster, written by the ledger
# repository (mig-ledger-widen). The boot seam that records its roster entry is
# mig-serving-gate's. The deploy contract is dev/docs/runbooks/upgrade-on-deploy.md.

Feature: Cloud upgrades run on deploy while old and new builds serve side by side
  As the platform running a gradual cloud rollout
  I want to know which builds are still serving and which steps each declares
  So that a background step needing every old writer gone finishes only when it is safe

  Background:
    Given a serving roster with a stale bound of 60 seconds and a refresh every 15 seconds

  @unit
  Scenario: A new process is live
    When a worker records its roster entry with image "git-abc1234" declaring step "trace:backfill-cost"
    Then the live processes are that worker, with its role, image and declared steps

  @unit
  Scenario: A process not refreshed within the stale bound is not live
    Given a worker recorded its roster entry
    When more than 60 seconds pass without a refresh
    Then no process is live

  @unit
  Scenario: A process that keeps refreshing stays live past the stale bound
    Given a worker recorded its roster entry
    When 5 minutes pass and the roster entry refreshes on its interval
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
    Given an api on the old image declaring no steps recorded its roster entry and then crashed
    And a worker on the new image declaring step "trace:backfill-cost" keeps refreshing
    When more than 60 seconds pass
    Then old writers are gone for step "trace:backfill-cost"

  @unit
  Scenario: Old writers are gone when no process is live
    Given no process has recorded its roster entry
    Then old writers are gone for step "trace:backfill-cost"

  @unit
  Scenario: A rollback to an image without the step makes old writers present again
    Given a worker on the new image declaring step "trace:backfill-cost" is live
    And old writers are gone for step "trace:backfill-cost"
    When a worker on the rolled-back image declaring no steps records its roster entry
    Then old writers are not gone for step "trace:backfill-cost"

  @unit
  Scenario: A gracefully stopped process is no longer live
    Given a worker recorded its roster entry
    When the worker stops
    Then no process is live

  @unit
  Scenario: A stop whose delete fails still stops, and the row lapses at the stale bound
    Given a worker recorded its roster entry
    And the ledger refuses to delete roster entries
    When the worker stops
    Then the stop completes without an error
    And after more than 60 seconds no process is live

  @unit
  Scenario: A refresh in flight when the process stops does not bring it back
    Given a worker recorded its roster entry
    And a refresh is in flight
    When the worker stops
    Then no process is live once the refresh has settled

  @unit
  Scenario: A failed refresh is reported and the next interval refreshes again
    Given a worker recorded its roster entry
    And the ledger refuses the next roster write
    When the refresh interval passes twice
    Then the failure is reported once
    And the worker is live with the later heartbeat

  @unit
  Scenario: A refresh interval not below the stale bound is refused
    When a serving roster is created with a refresh every 60 seconds and a stale bound of 60 seconds
    Then creating it is refused with a range error

  @unit
  Scenario: A roster entry without a process id is refused
    When a worker records its roster entry with an empty process id
    Then recording is refused and nothing is written

  @unit
  Scenario: A process whose first roster write fails is told so
    Given the ledger refuses the next roster write
    When a worker records its roster entry
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

  # Rollbacks (round 9, S3-ROLLBACK): detected from the serving roster, never ordered by version, so a
  # git-<sha> rollback is seen too. Reopening touches only done steps: level-triggered work
  # re-runs, and a second sighting finds nothing left to reopen.
  @unit
  Scenario: An older image serving after the last run reopens the background steps it does not declare
    Given the last upgrade run finished and the background step "trace:backfill-cost" is done
    When a process whose image does not declare "trace:backfill-cost" is admitted after that run
    Then "trace:backfill-cost" is reopened as pending, naming the image that was seen

  @unit
  Scenario: A rollback seen twice reopens the steps once
    Given an older image's process already reopened "trace:backfill-cost"
    When a second process of that image is admitted
    Then nothing is reopened again

  @unit
  Scenario: A process that declares every done background step reopens nothing
    Given the last upgrade run finished and the background step "trace:backfill-cost" is done
    When a process whose image declares "trace:backfill-cost" is admitted
    Then nothing is reopened

  @unit
  Scenario: A ledger with no finished upgrade run reopens nothing
    Given no upgrade run has finished
    When a process whose image declares no background step is admitted
    Then nothing is reopened

  @unit
  Scenario: A reopen that fails does not refuse the start
    Given an older image's process is admitted after the last run
    And the ledger refuses the reopen
    Then the process is admitted
    And the failure is reported

