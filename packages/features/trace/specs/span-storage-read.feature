Feature: Reading one stored span back for a derivation consumer

  A subscriber that derives facts from a span is handed a reference, not the
  span. It reads the row back out of canonical span storage, and the read has
  to stay cheap: the span table is partitioned by week and the reference
  carries the span's own start time, so a read that forgets the hint scans
  every partition, including the cold ones on object storage.

  The failure directions are asymmetric. A miss is ordinary — the span may not
  have landed yet — and answers absent. A refusal is not, and must reach the
  caller so the queue redelivers rather than deriving from nothing.

  @unit
  Scenario: The referenced span is read back inside its own partition window
    Given a span reference carrying the span's own start time
    When the derivation consumer reads that span back
    Then the read is bounded to a window centred on that time rather than every partition
    And it pins the tenant, trace and span of the reference so the read hits the primary key prefix
    And the row it returns is the canonical span the consumer expects

  @unit
  Scenario: The derivation read never asks for the nested columns
    Given a derivation consumer that reads no events and no links
    When the span is read back
    Then the nested event and link columns are not selected
    And the read keeps its lazy-materialization setting and takes the latest version only

  @unit
  Scenario: A span that has not landed is a miss, not an unbounded scan
    Given a referenced span that is not in its own window yet
    When the derivation consumer reads it back
    Then the answer is absent after that single bounded probe
    And the read is never widened to every partition

  @unit
  Scenario: A tenantless read is refused before it reaches ClickHouse
    Given a read whose tenant is blank
    When the derivation consumer issues it
    Then it is refused before a client is resolved
    And no query is sent

  @unit
  Scenario: A refused read is reported rather than answered as absent
    Given ClickHouse refuses the read
    When the derivation consumer issues it
    Then the failure reaches the caller so the queue redelivers it
