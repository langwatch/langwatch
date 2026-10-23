Feature: Small ClickHouse pods get an explicit memory budget
  ClickHouse sizes each cache at up to half of RAM and starts hundreds of
  background threads, each keeping its own allocator cache. On a pod of 4 GiB
  or less that leaves too little room for inserts and queries, so the image
  renders a budget for those pods and leaves larger pods on ClickHouse defaults.

  @unit
  Scenario: A pod of 4 GiB or less bounds its caches, threads and system logs
    Given a single-node ClickHouse pod with 1, 2 or 4 GiB of RAM
    When the image computes its server settings
    Then the caches are sized from RAM, idle thread pools are trimmed and system log queues are capped

  @unit
  Scenario: A replicated small pod keeps its thread pools
    Given a replicated ClickHouse pod with 4 GiB of RAM
    When the image computes its server settings
    Then the caches and system log queues are bounded
    And the background thread pools keep the ClickHouse defaults, because replication fetches and schedules on them

  @unit
  Scenario: A pod of 8 GiB or more keeps the ClickHouse defaults
    Given a ClickHouse pod with 8 or 16 GiB of RAM
    When the image computes its server settings
    Then none of the small-pod settings are rendered
