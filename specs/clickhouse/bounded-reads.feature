Feature: A read that cannot be pruned must still be bounded

  Every retention-managed table is partitioned on its time column, so a query
  with no lower bound prunes nothing: ClickHouse opens every weekly partition,
  including the cold ones on S3, to find rows it could have seeked to. The cost
  is not a slow query, it is a scan of the entire history on every call.

  Two shapes of that bug ran in production at once, and they compound: an
  unbounded read is what makes a result set big enough to exhaust memory, and
  the recovery from exhausting memory is what killed the process.

  # ---------------------------------------------------------------------------
  # The floor
  #
  # A resolver that probes a recent window first and falls back to "no bound at
  # all" on a miss was the single largest source of `coldScan: true` queries in
  # production — 208 of 300 in one sampled window, all evaluation_runs.
  #
  # Flooring it is safe where scanning everything is merely expensive: rows past
  # the tenant's retention are TTL'd away, so a bounded query cannot hide a row
  # the unbounded one would have found. The floor is per tenant because
  # retention is per tenant — a project on a long custom policy must keep its
  # long lookback, and one on a short policy should not pay for someone else's.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A fallback read is floored at the tenant's retention horizon
    Given a read whose recent-window probe found nothing
    When it falls back to the wider seek
    Then the wider seek still carries a lower bound
    And that bound is older than the probe's, or the retry would repeat it

  @unit
  Scenario: The floor follows the tenant's own retention policy
    Given a tenant whose retention is longer than the platform default
    When a read floor is resolved for that tenant
    Then the floor reaches back to that tenant's retention, not the default

  @unit
  Scenario: The floor clears the retention horizon rather than sitting on it
    Given a resolved retention for a tenant
    When the floor is derived from it
    Then the floor is older than the horizon by a margin
    So that asynchronous TTL deletion and producer clock skew cannot hide a live row

  @unit
  Scenario: A retention lookup that fails falls back to the platform default
    Given the retention resolver throws
    When a read floor is resolved
    Then the platform default is used and the failure is reported
    But the read is never made unbounded, because that is the failure being fixed

  @unit
  Scenario: A caller with no resolver wired still gets a bounded read
    Given a repository constructed without a retention resolver
    When a read floor is resolved
    Then the platform default bounds the read

  # ---------------------------------------------------------------------------
  # The ceiling
  #
  # When a joined trace read exceeds ClickHouse's per-query memory cap, the
  # recovery re-runs it in batches of 25 and merges every batch into one map.
  # That bounds ClickHouse's peak memory and not ours — the same full result set
  # is materialised, just on this side of the socket.
  #
  # On 2026-08-12..16 a 980-trace read did exactly that on every worker at once:
  # 50 V8 heap deaths, 16:48 UTC, six days running, six to twelve pods each day.
  # The read had ALREADY failed in ClickHouse before the fallback ran, so
  # refusing it costs the caller nothing it had — it fails either way. What it
  # buys is that the failure stays inside one job instead of taking the process.
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: The memory-limit fallback stops before it exhausts the heap
    Given a joined trace read that ClickHouse refuses for memory
    And the batched retry would materialise more spans than the cap allows
    When the retry runs
    Then it stops and reports how far it got against the cap
    And the process survives to run the next job

  @unit @regression
  Scenario: A fallback that fits under the cap still returns every trace
    Given a joined trace read that ClickHouse refuses for memory
    And the batched retry fits under the cap
    When the retry runs
    Then every requested trace is returned
