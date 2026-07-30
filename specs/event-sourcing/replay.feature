# Design: dev/docs/adr/108-the-dispatch-plane.md (decision 12)
#
# Replaces projection-replay.feature. That file specified a coordinated
# pause/cutoff/resume mechanism (ADR-015) belonging to the deleted engine —
# this plane's replay is offline instead: it runs no live coordination because
# there is no live consumer to pause. Its scenarios about pausing live
# processing, a snapshot cutoff, deferring live events past a cutoff, and a
# coordination lock's lifetime describe that retired mechanism and are not
# carried forward. What survives is the customer-facing shape: a rebuild from
# history that does not wait on one write per aggregate, and a resumable,
# reportable run — restated here against the one-function, version-gated
# design that replaced it.

Feature: Replay rebuilds a projection's stored output from the event history

  Replay reads event_log for an aggregate or a bounded tenant range and
  re-runs the same fold and map executors the delivery path uses — there is
  no second projection code path to keep in agreement with the first. It never
  runs subscribers or process managers, because both do at-most-once or
  side-effecting work that must not be re-fired for history that already
  happened live.

  Background:
    Given a registered pipeline with a fold projection and a map projection

  Rule: Replay re-runs the same executors delivery uses, for folds and maps only

    @unit
    Scenario: Replaying a fold rebuilds its state from one aggregate's history
      Given an aggregate with existing event history
      When a replay runs for that aggregate
      Then the fold's state is rebuilt by applying that history through its own executor

    @unit
    Scenario: Replaying a map rebuilds its records from a bounded tenant range
      Given events across several aggregates within a tenant
      When a replay runs over that range
      Then the map's records are rebuilt from that history through its own executor

    @unit
    Scenario: Replay never runs a subscriber
      Given a pipeline with a subscriber mounted on the same events as its fold
      When a replay runs over that pipeline's history
      Then the subscriber is not invoked

    @unit
    Scenario: Replay never runs a process manager
      Given a pipeline with a process manager mounted on the same events as its fold
      When a replay runs over that pipeline's history
      Then the process manager's evolve is not invoked
      And no intent is staged as a result of the replay

  Rule: A row a current build could not have written is skipped, not overwritten

    @unit
    Scenario: A fold row stamped with a version this build does not expect is skipped
      Given an aggregate whose fold row was stamped with a state version this build does not recognise
      When a replay runs for that aggregate
      Then that aggregate's row is left untouched
      And it is counted as skipped by version rather than written over

    @unit
    Scenario: The report accounts for every event scanned, applied, and skipped
      Given a mix of aggregates, some replayable and one stamped with an unrecognised version
      When the replay finishes
      Then the report's event count matches what was scanned
      And its skipped-by-version count matches the rejected aggregate
      And its applied count matches everything else

  Rule: A replayed lane is named by the same renderer live dispatch uses

    @unit
    Scenario: Replay names its lane through the group-key renderer, not a hand-built string
      Given a fold replayed for a specific aggregate
      When the replay records which lane it rebuilt
      Then the recorded lane is exactly what rendering that aggregate's group key would produce

  Rule: Rebuilt map records are written in bulk, not one write per aggregate

    @unit
    Scenario: A map replay across many aggregates writes in one batch
      Given event history spanning many aggregates for one tenant
      When a map projection is replayed over that history
      Then its store receives one batched write for the whole run
      And not one write per aggregate

  Rule: A replay can be scoped to named projections

    @unit
    Scenario: Naming one projection replays only that one
      Given a pipeline with both a fold and a map projection
      When a replay names only the fold projection
      Then the fold is rebuilt
      And the map's store receives no write

  Rule: Replaying an unregistered aggregate type fails loudly

    @unit
    Scenario: A replay request naming no registered pipeline is rejected
      Given no pipeline is registered for the requested aggregate type
      When a replay is requested for it
      Then the replay is rejected rather than silently reporting nothing happened
