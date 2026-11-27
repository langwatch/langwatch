Feature: The projection-replay-sole-caller policy
  The deploy-time lane replayer trusts the queue's claimed-groups index only
  because every call runs after the ops:fill-queue-tenant-claims backfill, an
  order defineProjectionReplayStep forces
  (packages/group-queue/adrs/092-tenant-claims-index.md). So a replayLane call
  anywhere else is refused. Tests are not scanned.

  Rule: `projection-replay-sole-caller` refuses replayLane outside the replay step

    @unit
    Scenario: A module calls replayLane directly
      Given a file in the billing module calls replayLane on a replayer
      When the projection-replay-sole-caller policy reads the workspace
      Then it reports the file and the line

    @unit
    Scenario: Only the projection replay step drives the deploy-time lane replayer
      Given the projection replay step and the process replayer call replayLane
      And a test file calls replayLane
      When the projection-replay-sole-caller policy reads the workspace
      Then it reports nothing
