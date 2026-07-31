Feature: The schema catalogue is the one description of our tables, and it is enforced

  Our ClickHouse conventions — filter on the partition column, always scope to a
  tenant, dedup by the version column — are followed by hand today, and hand-kept
  descriptions of the tables rot. Three separate copies of "which column does this
  table partition on" had drifted: the runtime cold-scan detector knew eleven of
  the thirty-three partitioned tables, a facet registry knew three, and the
  written guidance named the wrong column for one table and the wrong dedup key
  for another. None of them went red, because nothing ever compared them to the
  migrations that actually create the tables.

  So there is one catalogue, it is compared to the migrations by a test that
  fails on any disagreement, and the guards read from it rather than keeping
  their own lists.

  Enforcement is deliberately split. Most of our SQL is assembled from
  interpolated fragments, so no static reader can see the finished query — those
  rules are checked at run time, against the string actually being sent. A few
  rules live in the literal text and are visible to a scanner, so those are
  checked before the code ever runs, which also reaches the paths no test
  exercises.

  The runtime side refuses by default. The gate shipped counting-only first,
  measure-then-limit (ADR-068's line); the refusal followed as an owner
  decision (2026-07-31): a non-bounded ClickHouse call must be impossible by
  default. A read with a real time range bounds on it. A read with none makes
  the statement explicit with retentionBound() and gets a real predicate at
  the widest range a live row can occupy — the retention window plus the
  lazy-TTL cushion. LANGWATCH_CLICKHOUSE_CONVENTION_GATE=warn restores
  count-and-warn as the operational parachute, not as a lifestyle.

  # ---------------------------------------------------------------------------
  # The catalogue, pinned to the migrations
  # ---------------------------------------------------------------------------

  Rule: The catalogue and the migrations agree, or the build fails

    @unit
    Scenario: a table created by a migration but missing from the catalogue is reported
      Given a migration creates a partitioned table
      And the catalogue has no entry for it
      When the catalogue is compared to the migrations
      Then the comparison fails and names the missing table

    @unit
    Scenario: a catalogue entry that names the wrong partition column is reported
      Given the catalogue declares a partition column for a table
      And the migration that created the table partitions it on a different column
      When the catalogue is compared to the migrations
      Then the comparison fails, naming the table, the declared column and the column the migration uses

    @unit
    Scenario: a catalogue entry that names the wrong sort key is reported
      Given the catalogue declares a sort key for a table
      And the migration that created the table sorts it differently
      When the catalogue is compared to the migrations
      Then the comparison fails, naming the table and both sort keys

    @unit
    Scenario: a sort key a later migration extended is read from the later migration
      Given a table whose sort key a later migration extended
      When the catalogue is compared to the migrations
      Then the extended sort key is what the catalogue must declare, not the original

    @unit
    Scenario: a table a later migration dropped is not required in the catalogue
      Given a migration created a table and a later migration dropped it
      When the catalogue is compared to the migrations
      Then the dropped table is not required to have a catalogue entry

    @unit
    Scenario: the comparison notices when it has stopped reading the migrations
      Given the comparison finds implausibly few tables in the migration directory
      Then it fails rather than reporting that everything agrees

  Rule: Whether a row can change partitions is asserted by a person, not inferred

    Two tables can carry an identically-named partition column and behave
    completely differently. One table's is written once and frozen — it anchors
    the row's storage for life. Another's is re-stamped from the newest event
    every time the row is rewritten, so the row migrates between partitions as
    it progresses. A reader who assumes the first behaviour of the second writes
    a time-bounded query that silently misses rows. No parser can tell them
    apart, so a person asserts it, in writing, next to the evidence.

    @unit
    Scenario: every catalogued table declares whether its partition column can move
      Given the catalogue
      When each entry is inspected
      Then each declares its partition column as frozen, movable, or explicitly unverified

    @unit
    Scenario: every stability declaration carries the evidence it was derived from
      Given the catalogue
      When each entry is inspected
      Then each stability declaration is accompanied by a written rationale

  # ---------------------------------------------------------------------------
  # The runtime gate — counting, on every query, before it runs
  # ---------------------------------------------------------------------------

  Rule: Reads that cannot prune, and reads that are not tenant-scoped, are counted

    @unit
    Scenario: a read of a partitioned table with no filter on its partition column is counted
      Given a read of a catalogued table
      And the read carries no filter on that table's partition column
      When the read is inspected
      Then it is reported as unable to prune partitions

    @unit
    Scenario: mentioning the partition column without comparing it does not count as filtering on it
      Given a read that selects and orders by a table's partition column but never compares it
      When the read is inspected
      Then it is still reported as unable to prune partitions

    @unit
    Scenario: a read with no tenant predicate is counted
      Given a read of a catalogued table
      And the read carries no comparison on that table's tenant column
      When the read is inspected
      Then it is reported as unscoped

    @unit
    Scenario: a table whose tenant column is not the usual one is checked against its own column
      Given a read of a table whose tenant column is not the one most tables use
      And the read scopes to that table's own tenant column
      When the read is inspected
      Then it is not reported as unscoped

    @unit
    Scenario: every partitioned table is visible to the runtime check
      Given the catalogue
      When a read with neither a partition filter nor a tenant predicate is inspected for each catalogued table
      Then every catalogued table is reported

  Rule: A deliberate exception is registered, not commented

    A carve-out written as a comment survives exactly until someone tidies up.
    The exceptions we know about are registered against the table and the rule
    they excuse, so removing one is a visible change rather than a deletion.

    @unit
    Scenario: a registered exception suppresses the rule it was registered for
      Given a table registered as exempt from the tenant-predicate rule
      When a read of it with no tenant predicate is inspected
      Then it is not reported as unscoped

    @unit
    Scenario: a registered exception does not suppress the rules it was not registered for
      Given a table registered as exempt from the tenant-predicate rule only
      When a read of it with no filter on its partition column is inspected
      Then it is still reported as unable to prune partitions

    @unit
    Scenario: every registered exception says why it exists
      Given the registered exceptions
      When each is inspected
      Then each names the rule it excuses and the reason it is sound

  Rule: The gate refuses by default

    @unit
    Scenario: a violating read is refused before it is sent
      Given the gate is at its default setting
      When a read that violates a rule is checked
      Then the read is refused before any cost is paid
      And the violation is still counted
      And the refusal names the fix and the statement API

    @unit
    Scenario: the counter records the table and the rule separately
      Given a read that violates a rule
      When the violation is counted
      Then the count carries which table and which rule, so one table's offences can be read off on their own

    @unit
    Scenario: a read is checked before it is sent, not after it returns
      Given a read that violates a rule and then fails against the database
      When the read is attempted
      Then the violation is still counted

    @unit
    Scenario: warn mode counts without refusing, as the operational parachute
      Given the gate is relaxed to warn
      When a read that violates a rule is checked
      Then the violation is counted and the read is allowed to proceed

    @unit
    Scenario: a checker fault never refuses a read
      Given the violation checker itself throws
      When a read is checked
      Then the read is allowed to proceed

    @unit
    Scenario: a read with no estimable time range states it and passes
      Given a read whose only predicate is the retentionBound statement
      When the read is checked
      Then no partition violation is found
      And the bound sits at the retention window plus the lazy-TTL cushion

    @unit
    Scenario: a write is not judged by the read rules
      Given a statement that writes rather than reads
      When it is checked
      Then no violation is counted

  # ---------------------------------------------------------------------------
  # The corpus scanner — the rules that are visible in the source text
  # ---------------------------------------------------------------------------

  Rule: Patterns that are known to break under load do not come back

    NOT YET BUILT. These describe the source-text scanner (the second half of
    this feature) and nothing enforces them yet, so they are parked rather than
    left untagged — an untagged scenario reports "all bound" while binding
    nothing, which is the failure mode this project has been bitten by before.

    Note that the migration-hygiene rules this scanner was originally going to
    carry — one statement per goose block, no live SQL after `-- +goose Down` —
    are ALREADY enforced, in Go, by `tools/migrationorder`, including the
    shrink-only grandfather list for the three deployed migrations that ship a
    live Down block. They are deliberately not restated here.

    @unit @unimplemented
    Scenario: taking one row per key is refused outright
      Given source that takes a single row per key using the engine's per-key limit
      When the SQL corpus is scanned
      Then it is reported, because the deduplication pattern that survives our payload sizes is used instead

    @unit @unimplemented
    Scenario: taking several rows per key alongside a heavy column needs a written justification
      Given source that takes several rows per key from a table with a heavy column
      And the site carries no written justification
      When the SQL corpus is scanned
      Then it is reported

    @unit @unimplemented
    Scenario: a justified per-key limit is accepted
      Given source that takes several rows per key from a table with a heavy column
      And the site carries a written justification
      When the SQL corpus is scanned
      Then it is not reported

    @unit @unimplemented
    Scenario: deriving a sort key with a plain maximum is reported
      Given source that derives a paging sort key with a plain maximum over a grouped, deduplicated read
      When the SQL corpus is scanned
      Then it is reported, because a plain maximum can take its value from a superseded version of the row

    @unit @unimplemented
    Scenario: taking the newest row by ordering on the version column is reported
      Given source that selects the newest row by ordering on a table's version column and taking one
      When the SQL corpus is scanned
      Then it is reported

    @unit @unimplemented
    Scenario: forcing the engine to merge on read is reported
      Given source that forces the engine to merge duplicates at read time
      When the SQL corpus is scanned
      Then it is reported

    @unit @unimplemented
    Scenario: the scanner notices when it has stopped finding SQL
      Given the scan finds implausibly few files carrying SQL
      Then it fails rather than reporting a clean corpus

    @unit @unimplemented
    Scenario: the corpus is clean today
      Given the source tree as it stands
      When the SQL corpus is scanned
      Then only the sites recorded as known exceptions are reported
