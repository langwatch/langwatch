Feature: Cold-scan detector covers every partitioned ClickHouse table
  As an operator of a ClickHouse cluster running at its memory ceiling
  I want every time-partitioned table to be known to the cold-scan detector
  So that an unpruned read is flagged instead of quietly scanning the cold tier

  # The detector fails OPEN: `detectColdScan` only inspects tables listed in
  # TIME_PARTITIONED_TABLES, so a partitioned table missing from that map is
  # treated as un-partitioned and never flagged, however expensively it is
  # queried. The gap is invisible precisely because the detector reports
  # nothing — the map covered 11 of 35 partitioned tables, and the 24 missing
  # ones included `trace_analytics` and `trace_summaries`, whose unwindowed
  # reads ran as undetected cold scans at ~350/min.
  #
  # A comment saying "keep in sync" cannot catch that, so these scenarios parse
  # the migrations and assert the map matches them in both directions.

  @unit
  Scenario: Every partitioned table is known to the cold-scan detector
    Given a ClickHouse migration declares a table with a PARTITION BY expression
    When the cold-scan detector's table map is compared against the migrations
    Then that table is listed in TIME_PARTITIONED_TABLES so its unpruned reads get flagged

  @unit
  Scenario: The declared prune column actually appears in the PARTITION BY
    Given a table listed in the cold-scan detector declares one or more prune columns
    When each declared column is checked against the table's PARTITION BY expression
    Then at least one declared column appears in that expression, so a predicate on it can prune

  @unit
  Scenario: The map carries no table that is not partitioned
    Given a table is listed in the cold-scan detector's table map
    When the migrations are parsed for PARTITION BY declarations
    Then that table really is partitioned, so the detector never demands a predicate that cannot prune
