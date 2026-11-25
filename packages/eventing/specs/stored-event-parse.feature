Feature: Every stored event parses under the release's pipeline schemas and upcasts

  After an upgrade the branch's worker reads every event an older release appended to `event_log`.
  A stored row that no registered pipeline declares, or that its owner's upcast and current schema
  refuse, would fail at dispatch, replay or fold. A worker integration test the upgrade harness runs
  after settle proves none does (dev/docs/ARCHITECTURE.md section 9; upgrade soak scenario S14).
  It reads each ClickHouse target it is given, shared and private alike, and never prints a payload.

  @integration
  Scenario: Every stored event of a settled upgrade parses
    Given the ClickHouse targets of an upgraded deployment
    When the worker's installed pipelines parse the stored events of every target
    Then no event is refused

  @integration
  Scenario: Events are read by group, in bounded batches
    Given a target holding millions of stored events
    When the check reads it
    Then it counts events by aggregate type, event type and event version
    And it parses a bounded sample of each group, and every event of a group smaller than the sample

  @unit
  Scenario: A refusal is reported by group with its count and one example event id
    Given stored events whose owner's schema refuses some of them
    When the parse report is built
    Then each refused group names its target, aggregate type, event type and event version
    And it carries the refused count and one example event id, never payload contents

  @unit
  Scenario: A planted unknown event type is named
    Given a stored event whose type no registered pipeline declares
    When the parse report is built
    Then the report names that type as undeclared, with its count

  @integration
  Scenario: Private ClickHouse targets are read too
    Given a shared target and a private target, each listed in STORED_EVENTS_CLICKHOUSE_URLS
    When the check runs
    Then the report covers the stored events of both targets

  @integration
  Scenario: The report is written for the upgrade harness
    Given STORED_EVENTS_REPORT names a file
    When the check runs
    Then the file holds the refused groups as JSON, the same table the failure prints

  @integration
  Scenario: The check skips with a reason when no target is given
    Given STORED_EVENTS_CLICKHOUSE_URLS is unset
    When the check runs
    Then it is skipped with a message naming the variable
