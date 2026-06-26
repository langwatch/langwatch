# Spec introduced ahead of its implementation (the measurement lands in the
# stacked PR that adds the binding tests). Until then every scenario is an
# @unimplemented tracked gap so the feature-parity gate doesn't require bindings
# that live on a later branch. The implementation PR removes this feature-level
# tag and binds each scenario to a test.
@unimplemented
Feature: Billable stored-bytes measurement (ADR-027, Phase 2)
  As the storage-billing pipeline
  I want to measure the stored bytes an organization holds that are older than the free window, as of a sealed hour
  So that each hour's billable storage is computed once, correctly, and cheaply

  # The billable surface is "logical bytes (uncompressed _size_bytes) still stored AND older than
  # the free window", summed across all the org's projects, measured as of a past sealed hour H —
  # never now(). This is a pure read: no Stripe, no Postgres writes. The caller (the reporting
  # command) rounds bytes -> MiB.
  #
  # BILLABLE_AFTER_DAYS = 35 (5 weeks). Decision (2026-06-26): paid plans include 35 days free; a
  # default-keep org deletes at 35 and bills 0 by construction; only retention raised above 35
  # (42/49/63/90...) accrues. 35 is a clean toYearWeek partition boundary for pruning. Coupled change:
  # the paid minimum retention drops 49 -> 35 (MIN_RETENTION_DAYS) so a paid customer CAN select 35.
  # Free tier is separate (14-day window, recoverable to 21d, #4745) and never metered. The
  # measurement is correct for any cutoff value; 35 is a named constant.

  # ---------------------------------------------------------------------------
  # Core billing semantics: age, not volume
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Data older than the free window is billable
    Given an organization with one project
    And the project holds a row whose age at sealed hour H is older than the free window
    When billable storage is measured for the organization as of H
    Then the row's logical bytes are included in the result

  @unit
  Scenario: Data inside the free window is free
    Given an organization with one project
    And the project holds a row whose age at sealed hour H is within the free window
    When billable storage is measured for the organization as of H
    Then the row's logical bytes are excluded from the result

  @unit
  Scenario: The cutoff is anchored to the sealed hour, not now
    Given a project holding a row that crosses the free-window boundary between hour H and a later hour
    When billable storage is measured as of H and again as of the later hour
    Then the two measurements differ only by the rows that crossed the boundary in between
    And neither measurement depends on the wall-clock time it was run

  @unit
  Scenario: The sealed hour and cutoff are interpreted in UTC regardless of ClickHouse session timezone
    Given a ClickHouse session whose timezone is not UTC
    When billable storage is measured as of sealed hour H
    Then H and the free-window cutoff are bound as explicit UTC values
    And the boundary does not shift by the session timezone offset

  @unit
  Scenario: Deletion lowers a later hour's measurement, never an earlier one
    Given a project whose older-than-free-window bytes are reduced by retention deletion between hour H and a later hour
    When billable storage is measured as of H and as of the later hour
    Then the later measurement is lower by the deleted bytes
    And the measurement as of H is unchanged

  # ---------------------------------------------------------------------------
  # Organization rollup + tenant isolation
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An organization's measurement sums across all its projects
    Given an organization with three projects each holding older-than-free-window bytes
    When billable storage is measured for the organization as of H
    Then the result is the sum of all three projects' billable bytes

  @unit
  Scenario: Another organization's data is never included
    Given organization A with a project holding older-than-free-window bytes
    And organization B with a different project holding older-than-free-window bytes
    When billable storage is measured for organization A as of H
    Then only organization A's project bytes are included
    And every query is scoped by the organization's tenant ids

  @unit
  Scenario: An organization with no old data measures zero
    Given an organization whose projects hold only data within the free window
    When billable storage is measured for the organization as of H
    Then the result is zero

  @unit
  Scenario: A default-keep paid org bills zero by construction
    Given an organization whose projects use the default paid retention (the billing cutoff)
    When billable storage is measured for the organization as of H
    Then the result is zero
    Because retention deletes every row at the billing cutoff, so nothing is older than it

  # ---------------------------------------------------------------------------
  # Age column correctness vs partition pruning (the evaluation_runs case)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Each table is aged by its retention/TTL column, so the measurement matches what TTL deletes
    Given a table whose partition key differs from its retention/TTL column
    When billable storage is measured as of H
    Then the age predicate uses the table's retention/TTL column expression from the retention config
    So that a row still present (not yet TTL-deleted) is billed exactly when it is older than the free window

  @unit
  Scenario: The age comparison is byte-identical to the TTL delete expression
    Given a table whose retention column needs a conversion expression (e.g. epoch-millis to datetime)
    When billable storage is measured as of H
    Then the comparison uses the same column expression the TTL DELETE uses, sourced from the retention config
    So that billing can never diverge from deletion by reimplementing the conversion

  # evaluation_runs is the one table whose partition key (ScheduledAt, nullable) differs from its
  # retention/TTL column (UpdatedAt). We do NOT synthesize a ScheduledAt predicate from the UpdatedAt
  # predicate — UpdatedAt <= cutoff does not imply ScheduledAt <= cutoff (ScheduledAt can be future or
  # NULL), so such a predicate would silently drop rows from the bill.
  @unit
  Scenario: A table whose partition key differs from its retention column is not pruned by an unsound predicate
    Given the evaluation_runs table partitioned by ScheduledAt but retention-anchored on UpdatedAt
    When billable storage is measured as of H
    Then the query filters only on the UpdatedAt retention column
    And no ScheduledAt predicate is synthesized that could exclude future-dated or NULL-ScheduledAt rows

  # KNOWN, ACCEPTED SEMANTIC (needs sign-off): evaluation_runs is billed on UpdatedAt, which is
  # mutable. A row re-written after creation resets its age and can fall back inside the free window.
  # This is the only column under which "billed iff still present" stays coherent with what TTL
  # deletes (ScheduledAt/StartedAt are nullable and rejected by ClickHouse TTL).
  @unit
  Scenario: evaluation_runs bills on time-since-last-update, a documented limitation
    Given an evaluation_runs row older than the free window by creation but updated within the free window
    When billable storage is measured as of H
    Then the row is treated as inside the free window and excluded
    And this under-bill is an accepted, documented limitation of the mutable retention column

  # ---------------------------------------------------------------------------
  # Memory safety + billing-correct error handling
  # ---------------------------------------------------------------------------

  # Query-shape assertions are deterministic — inspect the captured queries like the existing
  # storageMeter unit test does (asserts clickhouse_settings). Real memory behaviour under load is a
  # separate, tolerant perf smoke, not a correctness gate.
  @unit
  Scenario: The measurement reuses the per-tenant path, not a cross-tenant IN, and caps each query
    Given an organization with several projects
    When billable storage is measured as of H
    Then each project is measured on its own tenant-routed query and summed in application code
    And the measurement does not issue a single cross-tenant "TenantId IN (...)" scan
    And each table is pre-aggregated to a scalar before summing
    And every query carries the memory cap so the size recompute cannot exhaust query memory

  # ReplacingMergeTree tables count every un-collapsed row version in a plain sum(_size_bytes), so a
  # churny tenant's un-merged duplicates over-bill. Billing — unlike the UI's degrade-to-0 display —
  # cannot silently over-count. The dedup-vs-OOM trade-off must be a decided, documented behaviour.
  @integration
  Scenario: Un-merged duplicate row versions do not silently over-bill
    Given a table with un-merged duplicate versions of the same row
    When billable storage is measured as of H
    Then the measurement counts each row's logical bytes once, within a documented bounded tolerance
    And the dedup approach stays within the memory budget

  @unit
  Scenario: A table query failure fails the measurement instead of silently undercounting
    Given the measurement query for one managed table fails
    When billable storage is measured for the organization as of H
    Then the measurement reports an error
    And it does not return a total that silently omits the failed table's bytes

  # ---------------------------------------------------------------------------
  # Output contract
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The service returns raw logical bytes and leaves rounding to the caller
    Given an organization with billable bytes
    When billable storage is measured as of H
    Then the result is the raw logical byte count
    And the service does not round to MiB
