Feature: The no-raw-clickhouse-sql lint rule
  Once a module reads through the typed builder, its process half hands ClickHouse
  built statements, never SQL text (ADR-202 §3). Unported sites sit in a generated,
  shrink-only baseline that the rule reads; a removed site must lower it.

  @unit
  Scenario: A hand-written request to the ClickHouse client is reported
    Given `.query`, `.command` or `.exec` called with an object carrying `sql` or `query`
    Then the rule reports rawRequest naming the method and the key
  @unit
  Scenario: A request a repository did not build is reported
    Given a ClickHouse repository calling `.query` or `.command` with a passed-in or spread request
    Then the rule reports forwardedRequest, and a service doing the same is left alone
  @unit
  Scenario: An object spelling SQL under sql in a ClickHouse repository is reported
    Given a mapper returning `{ sql: ... }`
    Then the rule reports sqlProperty there and nothing in a service
  @unit
  Scenario: A tenant or cold-scan opt-out on a hand-written request is reported
    Given SKIP_TENANT_CHECK or SKIP_COLD_SCAN_CHECK on a non-insert object in a ClickHouse repository
    Then the rule reports skipMarker naming the flag
  @unit
  Scenario: An import of the fence markers is reported
    Given process code importing @langwatch/clickhouse-markers
    Then the rule reports fenceMarker
  @unit
  Scenario: An import of the vendor ClickHouse client is reported
    Given a value import of @clickhouse/client
    Then the rule reports vendorClient, and a type-only import is left alone
  @unit
  Scenario: A built read, an insert and a test file pass
    Given a clickhouseRead statement sent with client.read, an insert, and raw SQL in a test file
    Then the rule reports nothing
  @unit
  Scenario: A file exempt by design passes
    Given raw SQL in the LangWatchQL executor
    Then the rule reports nothing, and every exempt file exists with a reason
  @unit
  Scenario: A listed mutation file passes its writes and still reports its reads
    Given a system-identity mutation file with a command, a write query and a read
    Then the rule reports only the read
  @unit
  Scenario: A baselined file at its listed count passes
    Given a listed file holding exactly its listed count of raw sites
    Then the rule reports nothing
  @unit
  Scenario: A baselined file below its listed count is told to lower the baseline
    Given a listed file holding one site fewer than listed
    Then the rule reports baselineStale once with both counts
  @unit
  Scenario: A baselined file above its listed count reports every site
    Given a listed file holding one site more than listed
    Then the rule reports every site
  @unit
  Scenario: Every baselined file still exists as module process source
    Given the baseline file
    Then every key is an existing, governed, non-exempt module process file with a positive count, in order
