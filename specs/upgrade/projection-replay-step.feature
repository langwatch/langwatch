# Projection replay as a deploy step (round 11: a migration step that replays a named projection
# lane from its owner's log as a background step). A module declares the step in .withMigrations;
# the worker runs it; the shared replay engine pauses the lane per batch and resumes it after.

Feature: A module fills a new read model at deploy by replaying a projection lane
  As a module that adds a read model over events another module already recorded
  I want a background step that replays the lane from its owner's log
  So that the read model is complete after the upgrade without an operator running a replay

  @unit
  Scenario: A projection replay step is a background data step its module declares
    Given a module declares a projection replay step for the lane "directoryMembers"
    Then the step is a data step that runs in the background under the module's id

  @unit
  Scenario: A replay step fills an empty read model from its owner's log
    Given an empty read model and an owner's log holding three events over two aggregates
    When the step replays the lane "directoryMembers"
    Then the read model holds both aggregates folded from every event
    And no other lane is written

  @unit
  Scenario: A first run replays the lane from the start of the log and records its cursor
    Given a projection replay step that never ran
    When the worker runs it
    Then the lane is replayed from the start of the log
    And the step reports the cursor it completed through

  @unit
  Scenario: A second run resumes from the cursor it last completed through
    Given a projection replay step that completed through a cursor
    When the worker runs it again
    Then the lane is replayed only from that cursor

  @unit
  Scenario: A second run with nothing new in the log changes nothing
    Given a lane already replayed through a cursor
    And no event arrived after it
    When the lane is replayed from that cursor
    Then no aggregate is rebuilt and the read model is unchanged

  @unit
  Scenario: The lane's live delivery is paused while it replays and resumes after
    When the step replays the lane
    Then the lane's live delivery is paused while its batch's cutoffs are taken
    And it is not paused once the replay ends

  @unit
  Scenario: Progress saves keep the last completed cursor
    Given a replay running in two batches from the start of the log
    When each batch completes
    Then the step saves its progress with the cursor it started from, renewing its lease

  @unit
  Scenario: A lane no registered pipeline declares is refused by name
    When a step replays a lane no registered pipeline declares, local or peer
    Then the run fails with "projection_lane_not_found" naming the lane
