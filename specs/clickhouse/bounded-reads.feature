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
  Scenario: Replacing a hand-picked floor can only widen it
    Given a read that already had a fixed retention floor
    When that floor is replaced by the tenant-aware one
    Then a tenant on a longer policy reaches further back than before
    And a tenant on a shorter policy still reaches at least as far as before
    So that adopting this cannot make an existing read miss rows it used to find

  @unit
  Scenario: A caller with no resolver wired still gets a bounded read
    Given a repository constructed without a retention resolver
    When a read floor is resolved
    Then the platform default bounds the read

  # The provider walks the project → team → organization cascade, so an
  # uncached lookup would put a database round trip in front of every read this
  # exists to make cheaper. Retention changes on human timescales.
  @unit
  Scenario: The retention lookup is not repeated for every read
    Given many reads for the same tenant and table
    When their floors are resolved
    Then the policy cascade is asked once, not once per read
    And one tenant's answer is never served to another
    And what is remembered is bounded, so many tenants cannot grow it forever

  # Remembering the ANSWER does nothing for the reads that arrive before there
  # is an answer to remember. The worker fleet runs the same sweep at the same
  # moment, so the first burst on a cold key is exactly when the cascade can
  # least afford one query per read.
  @unit
  Scenario: A cold retention lookup is shared by everyone waiting on it
    Given many reads for the same tenant and table arriving together
    And no cached answer for that tenant yet
    When their floors are resolved concurrently
    Then the policy cascade is asked once, not once per waiting read
    And every waiting read still receives a floor

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

  # A cap checked after the rows are decoded is not a cap. One batch is 25
  # traces at up to 10,000 spans each — 250,000 heavy rows, five times the cap
  # it is meant to enforce — so the batch that should have been refused is
  # materialised first, which is the heap death the cap exists to prevent.
  @unit @regression
  Scenario: A single over-budget batch is refused before it is materialised
    Given a joined trace read that ClickHouse refuses for memory
    And one batch of the retry alone would exceed the remaining span budget
    When that batch is read
    Then the read is bounded by the budget that is left
    And the over-budget rows never reach this process

  @unit @regression
  Scenario: A fallback that fits under the cap still returns every trace
    Given a joined trace read that ClickHouse refuses for memory
    And the batched retry fits under the cap
    When the retry runs
    Then every requested trace is returned
