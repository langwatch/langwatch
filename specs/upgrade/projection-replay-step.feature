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

  # Plan pr-7536 revision 2, F-5 and F-9 (MIG-REPLAY-SCALE): a replay at cloud scale is held one
  # tenant at a time, checkpoints each tenant, stops on the worker's signal and stamps retention.

  @unit
  Scenario: A lane is replayed one tenant at a time
    Given an owner's log holding events for two tenants
    When the step replays the lane
    Then the tenants are listed first and each tenant's aggregates are discovered on their own
    And every discovery names its tenant, so the routed member answers it on that tenant's server

  @unit
  Scenario: A log that cannot list its tenants is replayed in one pass
    Given an owner's log that cannot list the tenants holding a lane's events
    When the step replays the lane
    Then every tenant is discovered and replayed in one pass, as before

  # Round 51 (Alex, 2026-10-08): the shared log lists only the shared server's tenants, so the
  # tenant directory lists the tenants of privately routed organisations from Postgres and the
  # replay discovery unions the two. Each tenant is still replayed through its routed target.

  @unit
  Scenario: A tenant held only on a private dataplane is replayed
    Given the shared log lists one tenant
    And the tenant directory lists another tenant of a privately routed organisation
    When the step replays the lane
    Then both tenants are discovered and replayed, each under its own tenant id

  @unit
  Scenario: A tenant listed by both the shared log and the tenant directory is replayed once
    Given the shared log and the tenant directory both list the same tenant
    When the step replays the lane
    Then that tenant is discovered and replayed once

  @unit
  Scenario: The tenant directory pages a privately routed organisation's tenants with a cursor
    Given a privately routed organisation with more projects than one page holds
    When the tenant directory lists its tenants
    Then the organisation and each of its projects are listed once
    And each page is read after the last id of the page before, never the whole table at once

  @unit
  Scenario: A process with no private route lists only the shared log's tenants
    Given a process whose ClickHouse member has no private route
    When a replay lists its tenants
    Then the tenant directory is not asked

  @unit
  Scenario: Each completed tenant is saved with the cursor its run completes through
    Given a replay over two tenants
    When each tenant completes
    Then the step saves the cursor it started from, the cursor the run completes through and the tenant it completed

  @unit
  Scenario: A run resumed after an interruption skips the tenants it completed
    Given a step that saved progress through its first tenant
    When the worker runs it again
    Then only the tenants after it are replayed, from the same start cursor
    And the step completes through the cursor the interrupted run took, not a new one

  @unit
  Scenario: A worker stop ends the replay without finishing it
    Given a replay running over two tenants
    When the step's signal aborts while the first tenant is replaying
    Then no further batch or tenant starts and the run ends aborted, not done
    And the lane's live delivery is not left paused
    And the step's saved progress still names only what completed

  @unit
  Scenario: The cursor a run completes through allows for a lagging clock
    When a run completes
    Then the cursor it reports is the instant the run started less the clock-skew margin
    And a later run from that cursor replays an event a lagging api stamped just before the run started

  @unit
  Scenario: A replayed lane stamps the retention its pipeline declares
    Given a pipeline that declares each tenant's retention
    When one of its lanes, or a peer lane it declares, is replayed
    Then the rebuilt rows carry the retention the pipeline resolves for their tenant, not the platform default

  # Round 49 (data-meter R1): a writer an image older than the step's own may append after the first
  # pass discovered its tenant; a trailing pass from the first pass's cursor replays what it missed.

  @unit
  Scenario: A step with a trailing pass replays again from the cursor its first pass completed through
    Given a projection replay step declared with a trailing pass
    When the worker runs it and its first pass completes through a cursor
    Then the step saves that cursor before the trailing pass starts
    And the lane is replayed a second time from that cursor
    And the step reports the cursor the trailing pass completed through and the work of both passes

  @unit
  Scenario: A trailing pass interrupted by a worker stop resumes from the first pass's cursor
    Given a step with a trailing pass whose first pass completed and whose trailing pass was stopped
    When the worker runs it again
    Then the lane is replayed from the cursor the first pass completed through, not from the start

  @unit
  Scenario: A dry run or a stopped run takes no trailing pass
    Given a projection replay step declared with a trailing pass
    When it runs as a dry run, or its signal aborts during the first pass
    Then the lane is replayed only once
