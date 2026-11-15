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

  # T7-F14: a private route naming an organisation that does not exist must not fail the step.
  @unit
  Scenario: A tenant with no known organisation is skipped and the replay finishes
    Given the tenant directory lists a tenant whose organisation does not exist
    When the lane is replayed
    Then that tenant is skipped with a warning and nothing is deleted
    And every other tenant is replayed and the step completes

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

  # A reader that shows where a replayed lane's history starts reads it from the step (analytics ADR-006).

  @unit
  Scenario: A replay step's report keeps the instant its lane was first replayed from
    Given a projection replay step that completed and runs again from its cursor
    When the worker runs it
    Then every report it saves and returns names the instant its first run replayed from

  # A batch's event read sorts every row it returns, payloads included, before the first row
  # leaves the server, so one read of a heavy batch can outgrow a small server's memory. The
  # source sizes each aggregate first (event count, payload bytes) and reads the batch in slices
  # within a budget, an aggregate always whole within one.

  @integration
  Scenario: A batch's events are read in slices sized by their payload
    Given a batch whose events' payloads outgrow the ClickHouse server's memory for one read
    When the step replays the lane
    Then the batch's events are read in slices within the read budget, each aggregate whole within one
    And every event is applied once, each aggregate's in the order it was recorded

  @integration
  Scenario: A slice over the server's memory before it applied an event is read as halves
    Given a slice whose read hits a ClickHouse memory limit, the server-wide one included, before it applied an event
    When the step replays the lane
    Then the slice is read again as two halves, each halved again until it fits
    And every event is applied once, each aggregate's in the order it was recorded

  @unit
  Scenario: A slice over the server's memory after it applied an event fails without halving
    Given a slice whose read hits a ClickHouse memory limit after it handed an event on
    When the step replays the lane
    Then the read fails with that error and no half is read

  # A heavy tenant's batch can outgrow ClickHouse's per-query memory limit on its event query.
  # That is a size failure: a fold lane splits its batch in halves down to one aggregate.
  # Unlike the group queue's bisection (LANGWATCH_GQ_BISECTION_SPLIT_BUDGET), it has no budget;
  # its depth is bounded by log2 of the batch size. A map lane writes rows mid-stream, so it splits
  # only before its first write (a rerun half would append twice). Other failures stop as before.

  @unit
  Scenario: A batch over the query memory limit is split until it fits
    Given a fold lane's batch whose event query outgrows ClickHouse's per-query memory limit
    When the step replays the lane
    Then the batch's markers are cleared and it is replayed as two halves, each split again until it fits
    And every aggregate's read model equals a replay that never hit the limit

  @unit
  Scenario: A batch that hits the query memory limit mid-stream is not applied twice
    Given a fold lane's batch whose event query hits the memory limit after some of its events were read
    When the step replays the lane
    Then nothing of the failed attempt is written
    And every aggregate's read model equals a replay that never hit the limit

  # One aggregate can outgrow the limit alone, and a split cannot go below one. Its bulk read sorts
  # the whole aggregate, payloads included; read in pages behind an (EventTimestamp, EventId)
  # cursor, each statement sorts at most one page: 1,000 events or 32 MiB of payload. A page counts
  # in the step's report as it starts, since a run cut at its deadline can no longer save; the next
  # run pages that aggregate at once, and after three cut paged attempts the lane fails by name.

  @unit
  Scenario: A lone aggregate over the query memory limit is replayed in pages
    Given an aggregate whose own bulk event query outgrows the per-query memory limit
    And no map row of the attempt was written
    When the step replays the lane
    Then the bulk query fails before any read model write
    And the aggregate is replayed again from its pages
    And its read model equals a replay that never hit the limit

  @integration
  Scenario: A paged trace writes the trace_analytics row its bulk read writes
    Given a small trace replayed by the trace analytics widget-columns lane
    When its bulk read succeeds in one replay and is over the per-query memory limit in another
    Then both replays write the same trace_analytics row, apart from its fold-time stamps

  @unit @integration
  Scenario: A paged aggregate's pages stay within the page caps at any size
    Given two lone aggregates, one ten times the other's size
    When each is replayed in pages
    Then no page holds more events or payload bytes than the page caps
    And every event of each is applied once, in order

  @integration
  Scenario: A lone aggregate over the server's memory fails its bulk read and completes in pages
    Given a ClickHouse whose per-query memory is smaller than one aggregate's payloads
    When the aggregate's events are read in one bulk read
    Then the read fails on the per-query memory limit
    And read in pages, every event is applied once, in order

  @unit
  Scenario: A page ends before its payloads pass the byte cap
    Given an aggregate's next events whose payloads together pass the page's byte cap
    When the page is read
    Then it ends at the last event whose payload fits, sized without sorting a payload
    And copies of one event not yet merged are sized together and never split across pages
    And an event over the cap alone is a page of its own

  @unit
  Scenario: A paged aggregate applies only events at or before its cutoff
    Given aggregates read in pages, each with its own cutoff
    When their pages are applied
    Then an event past its own aggregate's cutoff is skipped, as the bulk read skips it

  @unit
  Scenario: A paged aggregate logs each page's size and time, numbers only
    Given an aggregate read in pages
    When each page is applied
    Then the log records the page's number, events, milliseconds and the running total
    And it names no tenant and no aggregate

  @unit
  Scenario: An aggregate paged before is paged at once on the next run
    Given a step whose report lists an aggregate an earlier run had to page
    When the step replays the lane
    Then that aggregate is read in pages without a bulk read of a batch holding it

  @unit
  Scenario: An aggregate whose paged replay was cut three times fails the lane by name
    Given an aggregate whose paged replay three runs started and their deadline cut
    When the step replays the lane again
    Then the lane fails naming the aggregate's type and id, without paging it again
    And the message names no tenant

  @unit
  Scenario: A replay step keeps the aggregates it had to page across runs
    Given a step run that started paging an aggregate and was cut
    When the step runs again from its saved report
    Then the replay is told the aggregate pages, with its unfinished attempts
    And an attempt that finishes leaves the aggregate listed with none unfinished

  @unit
  Scenario: A lone aggregate failing for any other reason is not paged
    Given a lone aggregate whose event query fails with an error other than the per-query memory limit
    When the step replays the lane
    Then the lane fails with that error and no page is read

  @unit
  Scenario: A lone map aggregate over the query memory limit after writing rows is not paged
    Given a map lane's lone aggregate whose event query hits the memory limit after a drain wrote rows
    When the step replays the lane
    Then the lane fails with that error and no page is read

  @unit
  Scenario: A worker stop between the halves of a split batch ends the replay
    Given a fold lane's batch split for the query memory limit whose first half completed
    When the worker stops before the second half starts
    Then the replay ends with the stop and the second half is not replayed
    And the lane's live delivery is resumed

  @unit
  Scenario: A batch failing for any other reason fails the lane without splitting
    Given a batch whose event query fails with an error other than the per-query memory limit
    When the step replays the lane
    Then the lane fails on that batch with its error and no half is replayed

  @unit
  Scenario: A map lane over the query memory limit before writing a row is split until it fits
    Given a map lane's batch whose event query outgrows ClickHouse's per-query memory limit
    And the batch has written none of its rows when the limit is hit
    When the step replays the lane
    Then the batch's markers are cleared and it is replayed as two halves, each split again until it fits
    And every row is written once, as a replay that never hit the limit writes them

  @unit
  Scenario: A map lane over the query memory limit after writing rows fails without splitting
    Given a map lane's batch whose event query outgrows ClickHouse's per-query memory limit
    And the batch has already written some of its rows when the limit is hit
    When the step replays the lane
    Then the lane fails on that batch with its error and no half is replayed

  @unit
  Scenario: A map lane over the query memory limit while flushing its rows fails without splitting
    Given a map lane's batch whose rows are buffered when the final flush hits the per-query memory limit
    When the step replays the lane
    Then the lane fails on that batch with its error and no half is replayed

  @unit
  Scenario: A tenant stream still running when another hits the query memory limit writes no row of its own
    Given a map lane's batch spanning two tenants whose event streams run side by side
    And one tenant's stream hits the memory limit while the other is still reading more rows than a drain holds
    When the step replays the lane
    Then the other tenant's stream stops before the batch is split
    And every row is written once, as a replay that never hit the limit writes them
