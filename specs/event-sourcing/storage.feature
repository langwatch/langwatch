# Design: dev/docs/adr/109-storage.md, dev/docs/adr/107-the-pipeline.md
# (decisions 9 and 11).
#
# Merges the former fold-store-library and fold-read-window features with the
# store-kind and client rules that had no spec of their own.

@unit
Feature: A table is declared once, and the declaration is checked against what is deployed
  A table definition is the single description of a table — columns, merge
  strategy, sort key, partition expression, tenant columns. Every read and write
  goes through it, so a column's type is stated once and inferred everywhere.

  That makes one class of mistake expensive in a way no comment can prevent. The
  client rejects unknown columns rather than dropping them, so a declaration
  naming a column the deployed table lacks is not a documentation error — it is a
  write that throws on every attempt, forever, with a lane retrying behind it.
  A declaration is therefore verified against the migration itself. Asserting a
  declaration's own literals back at it proves only that the file is internally
  consistent, which is exactly how three tables shipped naming columns that were
  never deployed.

  # ── declaration versus deployed reality ──

  Scenario: a declared column that no migration deploys fails the parity check
    Given a table declaration naming a column absent from its migration
    When the parity check runs
    Then it fails naming the table and the column
    And it reports the migration it read

  Scenario: a declared type that disagrees with the deployed type fails the parity check
    Given a column declared as an encoded string against a deployed array type
    When the parity check runs
    Then it fails naming both types

  Scenario: a declared sort key that disagrees with the deployed order fails the parity check
    Given a declaration whose sort key differs from the deployed ORDER BY
    When the parity check runs
    Then it fails, because a sort key cannot be altered in place

  Scenario: a declared partition expression that names an undeployed column fails the parity check
    Given a declaration partitioning on a column the deployed table does not have
    When the parity check runs
    Then it fails naming the partition expression

  Scenario: a known-wrong column is declared as debt rather than left silent
    Given a column whose true role differs from the role its name implies
    When the declaration records it as structural debt with a reason
    Then the parity check passes
    And the debt is reported where a reader of the declaration will see it

  Scenario: an insert carrying a column the table does not declare throws
    Given a row carrying a field the declaration does not name
    When it is inserted
    Then the write throws rather than dropping the field silently

  # ── the three store kinds ──

  Scenario: a fold mounts only on a store that reads back
    Given a fold mounted on a store that cannot read prior state
    When the pipeline is assembled
    Then the mount is refused, naming the fold and the store kind

  Scenario: a map mounts on append or merge, never on replace
    Given a map mounted on a replace store
    When the pipeline is assembled
    Then the mount is refused, because no executor accepts that pairing

  Scenario: a merge store is refused outright
    Given any new mount onto an additive merge store
    When the pipeline is assembled
    Then the mount is refused
    And the refusal explains that a per-write identifier would stop rows combining at all

  Scenario: a select is never retried by the client
    Given a read that fails on a transport error, which corrupts nothing if repeated
    When the client decides whether to retry
    Then it does not, and the failure reaches the caller on the first attempt
    And the reason given is that only writes are retried, not that the error was fatal

  Scenario: a replace write is retryable because the version column resolves a duplicate
    Given a replace store whose write is retried after a transport failure
    When both attempts land
    Then the newest version wins and the row is correct

  Scenario: an append write is retryable only when its sort key carries per-record identity
    Given one append table whose sort key identifies each record and one whose does not
    When a write to each is retried
    Then the keyed table collapses the duplicate at merge
    And the unkeyed table is not retried, because a retry duplicates permanently

  Scenario: an aggregating write is never retried
    Given an additive store whose write fails ambiguously
    When the client decides whether to retry
    Then it does not, because a retry would add the contribution twice

  Scenario: a durable write resolves only once the block has landed
    When a durable write is issued
    Then it does not resolve before the block is confirmed
    And nothing writes the cache ahead of that confirmation

  # ── state round-trip and versioning ──

  Scenario: a record written under the current shape is recovered as written
    Given a state committed under the shape the fold declares today
    When it is read back
    Then it is recovered exactly as written

  Scenario: a record in a shape this build cannot read is reported as found and refused
    Given a state committed under a shape this build no longer declares
    When it is read back
    Then the store reports it as found and undecodable
    And it does not report the aggregate as absent

  Scenario: an aggregate with no record at all is reported absent
    Given an aggregate that has never been committed
    When its state is read
    Then the store reports it absent, which the fold treats as genesis

  Scenario: changing what a fold stores without moving its stamp fails the build
    Given a fold whose state schema changed
    And whose version stamp did not move
    When the version check runs
    Then the build fails naming the fold

  Scenario: a pin records both the pinned stamp and the computed hash
    Given a fold pinning the stamp already present in production
    When the snapshot is written
    Then it records the pin and the hash the schema currently computes
    And a later shape change under the same pin fails

  Scenario: a fold with production rows and no pin fails its version gate on every row
    Given a fold with committed rows and no declared pin
    When a delivery reads one of those rows back
    Then the gate refuses it
    And the failure explains that adoption requires pinning the current stamp

  # Not yet implemented — no mount-time check inspects whether a ReplaceStore
  # implementation actually compares the stamp on read; this is a property of
  # a store's own code, not something validateMount can decide generically.
  @unimplemented
  Scenario: a store that ignores the stamp on read-back is refused
    Given a store whose read does not compare the stored version
    When the mount is assembled
    Then it is refused, because an old row would decode into defaults

  # ── writes, keys and anchors ──

  # Not yet implemented — foldExecutor.ts always writes after apply(); there is
  # no signal a fold can return meaning "nothing persistable yet, skip the write".
  @unimplemented
  Scenario: a state with nothing worth keeping is not committed
    Given a fold whose state holds no persistable signal yet
    When the delivery completes
    Then no row is written

  # Not yet implemented — foldExecutor.apply() commits one aggregate's delivery
  # at a time; no multi-aggregate bulk-commit API exists to compare against it.
  @unimplemented
  Scenario: committing many aggregates at once matches committing them one at a time
    Given several aggregates' states committed as one batch
    When the rows are read back
    Then each is identical to what a single-aggregate commit would have written

  Scenario: a composite engine key is bound column by column
    Given a table whose key spans several columns
    When a row is written
    Then each column is bound separately
    And the key is never collapsed into one concatenated value

  Scenario: a partition anchor is not re-stamped on every write
    Given a table whose partition column is platform-set and frozen
    When an existing row is written again
    Then the anchor keeps the value it was first written with

  # Not yet implemented — defineTable.ts checks the partition column and the
  # replacing version column separately; a single structuralDebt entry can
  # silently satisfy both for the same column with no distinct "double duty"
  # detection or message naming the two roles as one violation.
  @unimplemented
  Scenario: a version column and a partition column are never the same moving column
    Given a declaration whose version column is also its partition expression
    When the parity check runs
    Then it reports the double duty as debt requiring a re-key

  # ── retention ──

  Scenario: retention is stamped from the kind of data a record holds
    Given a record whose data kind resolves to a retention period
    When it is written
    Then the platform stamps that retention on it

  Scenario: a fold with no retention answer still keeps records for a bounded time
    Given a fold whose retention resolver returns nothing
    When a record is written
    Then a bounded default retention is stamped rather than none

  # ── reads are tenant-scoped and partition-bounded ──

  Scenario: every read filters on the tenant first
    When any read is issued
    Then the tenant predicate is present and leads the filter

  Scenario: a declared read window bounds the store read
    Given a read for which a time range is available
    When the store reads it back
    Then the partition column is bounded by that range

  # Not yet implemented — an unwindowed read runs unbounded (the default when
  # no readWindow is declared), but clickhouseReplacing() has no metrics port
  # at all, so nothing counts that it happened.
  @unimplemented
  Scenario: a read with no usable range reads unbounded and says so
    Given a read whose event carries no usable business time
    When the store reads it back
    Then the read is unbounded
    And the unbounded read is counted, so cold-partition scanning is visible

  Scenario: a windowed miss retries unwindowed before treating the aggregate as new
    Given a windowed read that finds nothing
    When the store decides whether the aggregate is absent
    Then it retries without the window first
    And only then reports absent

  Scenario: a row the store found but refused is not read again unwindowed
    Given a windowed read that found a row it could not decode
    When the store handles the refusal
    Then it does not retry unwindowed
    And it reports undecodable rather than absent

  # Not yet implemented — the IN-tuple GROUP BY/max(UpdatedAt) dedup pattern is
  # a query convention applied by hand at each call site; no reusable query
  # builder in packages/clickhouse implements or enforces it.
  @unimplemented
  Scenario: the latest version of a deduplicated row is read by grouped maximum
    When the latest version of a row is read
    Then the query groups by key and takes the maximum version in a subquery
    And it does not use a per-row limit that materialises heavy columns

  # Not yet implemented — same reason: no reusable pagination/argMax helper
  # exists in packages/clickhouse for this session to bind a unit test to.
  @unimplemented
  Scenario: a pagination sort key comes from the latest version only
    When rows are paginated by a derived sort key
    Then the key is taken from the latest version of each row
    And not from whichever version held the maximum value

  Scenario: a filtered column that is not in the sort key is refused
    Given a scoped read filtering on a column absent from the sort key
    When the query is reviewed against the declaration
    Then it is refused, because the engine may delete that row
