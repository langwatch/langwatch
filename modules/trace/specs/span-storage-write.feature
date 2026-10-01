Feature: Writing canonical spans to storage from a background process

  Every span a customer sends ends here: one row in `stored_spans`, the table
  the trace drawer, the span tree, the cost rollups and the coding-agent facts
  lift all read back from. The write is the only chance to get it right — a
  span is not re-derivable once its command has been acknowledged and its
  group has moved on.

  The table is a `ReplacingMergeTree(StartTime)` keyed on
  `(TenantId, TraceId, SpanId)` and partitioned by `toYearWeek(StartTime)`, so
  three of the columns written are structural rather than payload. The key
  triple decides which rows collapse into one; `StartTime` decides which of
  them survives the collapse AND which weekly partition the row lands in. A
  span stamped with the wrong start time is not merely mis-labelled: it
  deduplicates against the wrong neighbour and hides in the wrong partition,
  where every partition-pruned read walks straight past it.

  This write path is moving out of the application ahead of the trace
  conversion, so for now two copies of it exist. Neither compiles against the
  other. What they agree about — the table, its columns, the insert settings
  and the retention stamp — is a wire format between two processes writing the
  same rows, and drift in it is silent: ClickHouse accepts an insert that
  omits a column by filling in the column's default, and a reader cannot tell
  a defaulted value from a written one.

  @unit
  Scenario: The batch is one insert, not one insert per span
    Given a span-storage write path over a ClickHouse client
    When a process stores a batch of spans for one tenant
    Then it issues a single insert carrying every span in the batch
    And it resolves the tenant's client once

  @unit
  Scenario: The rows carry the columns the table declares
    Given a span-storage write path over a ClickHouse client
    When a process stores a span
    Then the row carries exactly the stored span columns, in the table's order
    And it is written to the stored spans table as JSON-each-row

  @unit
  Scenario: The insert tolerates a lone surrogate rather than dead-lettering the span
    Given a span-storage write path over a ClickHouse client
    When a process stores a span
    Then the insert asks ClickHouse not to reject a bad escape sequence
    And it asks for a synchronous asynchronous insert

  @unit
  Scenario: The version column is the span's own start
    Given a span-storage write path over a ClickHouse client
    When a process stores a span that started at a known time
    Then the row's start time is that time
    And the row's end time is the span's own end

  @unit
  Scenario: A batch may not mix tenants
    Given a span-storage write path over a ClickHouse client
    When a process stores a batch whose spans name two different tenants
    Then the write is refused as a security violation
    And no client is resolved and nothing is written

  @unit
  Scenario: The tenant decides which ClickHouse the rows reach
    Given a span-storage write path over a ClickHouse client
    When a process stores spans for a tenant
    Then the client is resolved for that tenant

  @unit
  Scenario: An empty batch touches nothing
    Given a span-storage write path over a ClickHouse client
    When a process stores an empty batch
    Then no client is resolved and nothing is written

  @unit
  Scenario: A span without a retention of its own is stamped with the deployment's
    Given a span-storage write path configured with a retention fallback
    When a process stores a span that declares no retention
    Then the row is stamped with the configured fallback

  @unit
  Scenario: A span that declares no retention at all is not silently kept forever
    Given a span-storage write path configured with a retention fallback
    When a process stores a span whose retention is zero
    Then the row is stamped with zero rather than the fallback

  @unit
  Scenario: The service name prefers the span's own attribute
    Given a span-storage write path over a ClickHouse client
    When a process stores a span naming a service on both the span and its resource
    Then the row takes the span's service name
    And a span naming a service nowhere is stored as an unknown service

  @unit
  Scenario: Attribute values reach ClickHouse as strings
    Given a span-storage write path over a ClickHouse client
    When a process stores a span carrying nested and scalar attributes
    Then every attribute value in the row is a string

  @unit
  Scenario: The dropped counts are the table's, not the span's
    Given a span-storage write path over a ClickHouse client
    When a process stores a span reporting its own dropped counts
    Then the row's dropped counts are zero

  @unit
  Scenario: A refused insert is reported rather than swallowed
    Given a span-storage write path whose ClickHouse refuses
    When a process stores a batch of spans
    Then the failure reaches the caller so the queue can retry it

  @unit
  Scenario: A background process can build the whole write path from what it holds
    Given a background process holding a tenant-keyed ClickHouse client
    When it composes the span-storage write path
    Then storing a projected span reaches ClickHouse as a stored span row
    And the row carries the retention the process was configured with
