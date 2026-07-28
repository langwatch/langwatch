Feature: Trace reads survive a ClickHouse memory limit

  Reading a page of traces pulls wide columns (ComputedInput/ComputedOutput,
  span attributes) for every trace on the page, so a large or unusually heavy
  page can exceed ClickHouse's per-query memory limit and fail the whole
  request. When that happens the read retries the page in smaller batches, and
  splits any batch that still fails, so one heavy trace no longer costs the
  user every other trace on the page.

  The recovery runs against a database that has just reported it is out of
  memory, so it is bounded on purpose: it must never turn one failed read into
  a sustained flood of queries at a struggling instance, and it must never
  quietly return fewer rows than the same read would have returned without
  memory pressure.

  Two test layers, matching specs/analytics/clickhouse-memory-safety.feature:
  1. Recovery behaviour and its bounds (unit, mocked failures)
  2. End-to-end recovery under a real memory limit (integration, real ClickHouse)

  Background:
    Given a project with traces stored in ClickHouse

  # ---------------------------------------------------------------------------
  # Layer 1: recovery behaviour and its bounds (unit)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A batch that still exceeds the memory limit is split and retried
    Given a page of traces whose full read exceeds the memory limit
    And the first smaller batch also exceeds the memory limit
    When the page is read
    Then that batch is split and each part is retried
    And every trace on the page is returned

  @unit
  Scenario: Splitting continues until a batch holds a single trace
    Given a page of traces where only a single-trace read fits in memory
    When the page is read
    Then the batches are split repeatedly until each holds one trace
    And every trace on the page is returned

  @unit
  Scenario: Recovery stops once its work budget is spent
    Given sustained memory pressure where large batches fail and small ones succeed
    When a page large enough to exhaust the recovery budget is read
    Then the read fails instead of continuing to retry
    And the total number of queries stays within the budget

  @unit
  Scenario: Retries of a split batch run one at a time
    Given a batch that is split after exceeding the memory limit
    When its parts are retried
    Then no two of those retries run at the same time

  @unit
  Scenario: A failure unrelated to memory is surfaced immediately
    Given a batch that is split after exceeding the memory limit
    And one part fails for a reason other than memory
    When the page is read
    Then that failure is reported without retrying the remaining parts

  @unit
  Scenario: Splitting a batch does not narrow the span search window
    Given a page read that is split into smaller batches
    When the spans for each batch are read
    Then every batch searches the same time window as the unsplit read

  # ---------------------------------------------------------------------------
  # Layer 2: end-to-end under a real memory limit (real ClickHouse)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A page still loads when the database runs out of memory
    Given a running ClickHouse test container with schema applied
    And traces heavy enough that reading the whole page exceeds a set memory limit
    When the page is read
    Then every trace on the page is returned

  @integration
  Scenario: A page recovered from a memory limit matches an unaffected read
    Given a running ClickHouse test container with schema applied
    And traces heavy enough that reading the whole page exceeds a set memory limit
    When the page is read under that limit and again without it
    Then both reads return the same traces in the same order

  @integration
  Scenario: A trace that cannot be read alone fails the page instead of retrying forever
    Given a running ClickHouse test container with schema applied
    And a memory limit no batch size can satisfy
    When the page is read
    Then the memory error is reported
    And the number of queries issued stays within the recovery budget
