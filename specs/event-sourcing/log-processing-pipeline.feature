@unit
Feature: The log pipeline is one content-addressed aggregate, mapped straight to storage
  A log record has no lifecycle. Nothing about it changes after it arrives, so
  every record is its own aggregate of exactly one event, and the aggregate id
  is the record's own content hash rather than something a caller supplies.
  Two deliveries of the same wire record hash to the same id, so redelivery is
  safe by construction: the store collapses the duplicate, not a dedup key
  bolted on afterwards.

  That shape drives the rest of the pipeline's declaration. There is nothing to
  fold, so the mount is a `map`, not a `fold` (ADR-098, ADR-105, ADR-106). The
  command lane needs no more than the aggregate scope every command gets by
  default, because a content-addressed aggregate never reads prior state or
  writes one back — there is no read-modify-write cycle for a wider lane to
  protect. The projection lane is the one place batching still matters: a map
  coalesces only within one lane, and one lane per record would mean one write
  per record, which is the exact shape that has already taken a ClickHouse
  table down. So the projection shards records into a bounded, hashed set of
  partitions and gathers a delivery into one bulk write (ADR-100).

  See specs/otlp/canonical-log-ingestion.feature for the customer-visible
  behavioural contract this pipeline preserves (structure, redelivery safety,
  partial success). This feature is about the pipeline's own internal
  declaration: what aggregate id a record gets, which lane its command and its
  projection land in, and what mount shape the projection is allowed to take.

  Background:
    Given the log aggregate, declared with one event and one command

  Scenario: A log record's aggregate id is its own content hash
    Given a canonical log record
    When the aggregate id is derived for it
    Then the aggregate id is exactly the record's recordId
    And two canonicalizations of the same wire record produce the same aggregate id

  Scenario: The command lane needs no sharding beyond the default aggregate scope
    Given the recordCanonicalLog command for two different records
    When their group keys are computed
    Then each is scoped to its own aggregate
    And the two records are never placed in the same lane

  Scenario: The projection lane shards records so their writes can coalesce
    Given many records whose content hashes land on the same shard
    When their group keys are computed for the canonicalLogStorage projection
    Then all of them render to the same lane
    And a lane scoped to a single record would not be able to batch this way

  Scenario: The projection's mount is a map over an append store, not a fold
    Given the canonicalLogStorage projection's declared mount
    When the mount is checked against ADR-106's legality table
    Then it is accepted with no violations
    And it is one of the table's enumerated legal combinations

  Scenario: A redelivered batch collapses to one row per table, not two
    Given a batch of canonical log records has already been written
    When the same batch is written again
    Then the store still issues a plain insert for each table
    And each record's own content hash is what the storage engine uses to
      collapse the duplicate, not application-level bookkeeping

  Scenario: The aggregate's persisted event-type strings are ratcheted
    Given the committed snapshot of the log aggregate's event-type strings
    When the aggregate's currently-declared type strings are compared against it
    Then nothing the snapshot remembers is missing from what the aggregate declares now
