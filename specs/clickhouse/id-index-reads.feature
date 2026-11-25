Feature: A lookup by id reads only the partitions its id index names

  Our large ClickHouse tables are partitioned by time but often looked up by id
  alone, with no time to prune on, so a lookup walks every partition, cold ones
  included. Each such table gets a small unpartitioned id index, filled by a
  materialised view on insert, that maps an id to the time range its rows live in.
  A lookup asks the index first and reads the source with that exact bound.
  (dev/docs/plans/id-index-2026-10-10.md)

  Background:
    Given a time-partitioned table with an id index owned by the same module

  @integration
  Scenario: a lookup by id reads only the partitions the index names
    Given a record written eight weeks ago
    When it is looked up by its id alone
    Then the read is bounded to the index's time range, widened by one day each side
    And it touches only the partitions inside that range
    And it is recorded as an index hit

  @integration
  Scenario: inserting a record fills its index row in the same insert
    When a record is inserted into the source table
    Then its id index row exists without any application code writing it

  @integration
  Scenario: a trace's spans arriving over time widen its index range
    Given a trace whose first span started on Monday
    When a late span from the same trace starting on Thursday is stored
    Then the trace's index range covers Monday to Thursday
    And a lookup of the trace's spans returns both spans

  @integration
  Scenario: a span lookup hits before the trace summary is projected
    Given a trace whose spans are stored but whose summary is not yet projected
    When its spans are looked up by trace id
    Then the read is bounded by the trace index and returns the spans

  @unit
  Scenario: an id the index has never seen probes recent data once and stops
    Given the index's backfill has completed
    And no record exists for the id
    When it is looked up by its id alone
    Then the read probes only the recent window and returns nothing
    And it never scans without a time bound
    And it is recorded as an index miss

  @unit
  Scenario: a miss whose source still holds rows is counted as a missing index row
    Given the index's backfill has completed
    And the index has no row for an id whose rows the recent source still holds
    When it is looked up by its id alone
    Then the rows are returned as before
    And it is recorded as an index miss that found rows
    And one warning per table names the tenant and the table, never the id

  @unit
  Scenario: a ledger replay is never taken for a new request on an index miss alone
    Given the ledger's index is ready and has no row for a request
    When a debit for that request arrives
    Then the recent ledger is checked before the debit is written
    And a request the recent ledger already holds is not debited again

  @unit
  Scenario: a batch that times out is halved, and a stuck target does not stop the others
    Given a backfill whose batches fail with a memory or timeout error
    When the backfill step runs
    Then each failure halves the batch, down to a floor
    And a target still failing at the floor is recorded as failed while the others are filled
    And the step reports failure at the end, so the ledger retries it

  @unit @integration
  Scenario: a retention raise is one statement per index, never lowering a row
    Given tenants whose retentions were lengthened, shortened and made forever
    When a target's id index is raised to each tenant's retention
    Then one mutation rewrites the index, each tenant to its own days
    And no row is lowered, kept forever stays forever, and the marker row is untouched

  @integration
  Scenario: the index expires with the data it points at
    Given a record in a project with a 30-day retention
    When the record's last row passes its retention
    Then its index row expires on the same retention, never before the source rows

  @unit
  Scenario: the index table has no partition key
    When the id index migrations are read
    Then no id index table declares a PARTITION BY
    And each is ordered by tenant then id

  @unit
  Scenario: the index table lives on the data disk, beside its source
    When the id index migrations are read
    Then each id index table takes the same storage policy as every other table
    And none moves to cold storage by TTL

  @integration
  Scenario: the backfill fills existing records and can run twice
    Given records stored before the index existed
    When the background backfill step runs, is interrupted, resumes and runs again
    Then every existing id has an index row covering all of its rows
    And running it again changes no index range

  @unit
  Scenario: until the backfill completes, a lookup keeps today's fallback
    Given the index's backfill step has not completed
    When a record is looked up by its id alone
    Then the read uses the existing windowed fallback rather than trusting the index

  @integration
  Scenario: replaying an aggregate reads only the weeks its events span
    Given an aggregate whose events span three weeks, a year ago
    When its events are read for replay with no lower bound
    Then the read touches only those weeks' partitions
    And events with an unknown occurred time are still included

  @integration
  Scenario: a projection replay re-inserting rows leaves the index range correct
    Given a trace whose index range covers Monday to Thursday
    When its projection is replayed and its rows are inserted again
    Then the trace's index range still covers Monday to Thursday

  @integration
  Scenario: a lengthened retention reaches the index
    Given a project whose traces are kept for 30 days
    When the project's trace retention is changed to 365 days
    Then the trace id index rows for that project carry 365 days as well

  @integration
  Scenario: a shortened retention never shortens the index
    Given an aggregate with some events kept forever and others kept for 365 days
    When the project's trace retention is changed to 30 days
    Then the aggregate's index row is still kept forever

  @integration
  Scenario: an aggregate the index has not seen reads its whole history
    Given the event log index is ready
    And an aggregate whose only events have no occurred time
    When its events are read for replay
    Then the read takes the existing unbounded path and returns every event

  @integration
  Scenario: an id kept forever is not expired by a finite-retention row
    Given an id whose earlier rows are kept forever
    When a later row for the same id arrives with a 30-day retention
    Then the id's index row is still kept forever

  @integration
  Scenario: events with an unknown occurred time do not widen an aggregate's range
    Given an aggregate with events last month and one event with no occurred time
    When its index range is read
    Then the range covers last month only

  @unit
  Scenario: an event is found first in the window its id's time names
    Given an event stored eight weeks ago whose occurred time is close to when its id was made
    When it is looked up by tenant and event id
    Then the first read touches only the partitions within seven days of the id's time

  @unit
  Scenario: an event whose occurred time drifted far from its id falls back
    Given a span exported today whose occurred time is three months ago
    When its event is looked up by tenant and event id
    Then the first read finds nothing and the lookup falls back to the existing path
    And the fallback is recorded

  @unit @integration
  Scenario: readers trust the index only once its marker row is written
    Given the owner's id index holds its marker row on this ClickHouse target
    And another target's index has no marker row while its source table has rows
    When tenants on each target are looked up by id alone
    Then only the tenant on the marked target reads through the index
    And the other target is checked again in the background until the fill writes its marker
    And no lookup waits on reading the marker

  @unit @integration
  Scenario: a fresh install with an empty table is ready at once
    Given an id index with no marker row over a source table with no rows
    When the owner's readiness is checked at boot
    Then it writes the marker row itself
    And lookups read through the index from then on

  @unit
  Scenario: a failed batch backs off and resumes from its cursor
    Given a backfill whose next batch fails twice and then succeeds
    When the backfill step runs
    Then it retries that batch after a growing pause
    And after a restart it resumes from the last committed batch, not the start

  @integration
  Scenario: a trace opens with no time
    Given a trace stored eight weeks ago and its owner's id index ready
    When its summary and spans are read with no time given
    Then each read is bounded to the partitions the index names

  @integration @unimplemented
  Scenario: the browser opens a trace by id alone
    Given a trace drawer opened from a link that carries no time
    When the drawer loads
    Then every read starts at once, without waiting for a time to be found

  @integration
  Scenario: a retention change during the backfill does not leave stale index rows
    Given a backfill in progress
    And a project's retention is lengthened from 30 to 365 days while it runs
    When the backfill completes
    Then every index row for that project carries the new retention

  @unit
  Scenario: an event id that is not a KSUID takes the existing lookup path
    Given a legacy event id that is not a KSUID
    When it is looked up by tenant and event id
    Then the lookup uses the existing path rather than a time from the id

  @unit
  Scenario: a tenant bigger than a batch is split by key range and read once
    Given a tenant with more rows in one partition than a fill batch holds
    And a source table whose sort key starts with the tenant and the index key
    When the fill walks that partition
    Then each batch reads one range of that tenant's keys
    And every source row is read exactly once

  @unit
  Scenario: a read names its id and the reader adds the index bound
    Given a statement that names its table, key and id with an id-bound marker
    When the index is ready on the tenant's target
    Then the reader reads the index for that id and bounds the statement by its range
    And a marker naming a table with no declared id index is refused

  @unit
  Scenario: a module declares its id indexes once and the framework fills them
    Given a module that declares its id indexes beside its goose migration
    When the process boots
    Then the declarations reach the ClickHouse client
    And one background fill step is built for them under the module's step id

  @unit
  Scenario: a caller's own time range stays hard once the index is ready
    Given a read that names its own time range and asks never to widen it
    When the index is ready and names a range for the id
    Then the read covers only where the two ranges overlap
    And it reads nothing when they do not overlap

  @unit
  Scenario: an id the index has never seen reads nothing when the read asks for nothing
    Given the index is ready and has no row for the ids
    When a read that treats a miss as absent looks them up
    Then it answers nothing without reading the source

  @unit
  Scenario: a paged span read counts and pages within one bound
    Given a trace whose spans lie outside the window of the time a caller gave
    When a page of its spans is read
    Then the total and the page come from the same bound
    And the trace's time is looked up at most once

  @unit
  Scenario: a read that already has a lower bound skips the index
    Given the event log index is ready
    When an aggregate's events are read with a lower bound of the caller's own
    Then the index is not asked
    And the read is bounded by the caller's lower bound

  @unit
  Scenario: an event missing from its aggregate's indexed stream is read for once
    Given the event log index is ready and names the aggregate's range
    When an event the aggregate does not hold is looked up by id
    Then one index read and one source read answer that it is not found
    And no wider read follows

  @unit
  Scenario: a fill retried after a failed first batch counts each partition once
    Given a fill whose target fails before its first batch is written
    When the ledger retries the fill
    Then the report's partition total counts that target's partitions once

  @unit
  Scenario: a target that failed part way resumes where it stopped after the others are filled
    Given a fill over two targets whose first target fails after committing a batch
    And the second target is filled in the same walk
    When the ledger retries the fill
    Then the first target resumes after its last committed batch
    And no partition is counted twice

  @unit
  Scenario: a marker never reaches ClickHouse unexpanded
    Given a statement that carries an id-bound marker
    When it is sent as a command, or streamed
    Then a command is refused before it reaches the server
    And a streamed read is answered through the bounded read, its marker expanded
