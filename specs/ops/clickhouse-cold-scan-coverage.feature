Feature: Cold-scan detector covers every partitioned ClickHouse table
  As an operator of a ClickHouse cluster running at its memory ceiling
  I want an unpruned read of a partitioned table to be flagged
  So that a cold scan surfaces instead of quietly scanning the cold tier

  # The detector fails OPEN: it only inspects tables it already knows are
  # partitioned, so a partitioned table it does not know about is treated as
  # un-partitioned and never flagged, however expensively it is queried. The
  # gap is invisible precisely because the detector reports nothing — it knew
  # 11 of 35 partitioned tables, and the 24 it missed included the ones behind
  # `trace_analytics` and `trace_summaries`, whose unwindowed reads ran as
  # undetected cold scans at ~350/min.
  #
  # A comment saying "keep in sync" cannot catch that, so these scenarios hold
  # the detector's view of the schema against the schema itself, in both
  # directions.

  @unit
  Scenario: The detector knows every table the schema partitions by time
    Given the schema partitions a table by time
    When the detector's view of the schema is held against the schema itself
    Then the detector knows that table, so its unpruned reads are flagged

  @unit
  Scenario: The predicate the detector asks for is one that can prune
    Given the detector will demand a time predicate on a table
    When that column is checked against how the table is really partitioned
    Then the partitioning uses it, so a predicate on it narrows the read

  @unit
  Scenario: The detector never demands a predicate that cannot prune
    Given the detector treats a table as partitioned
    When that table is checked against how the schema really partitions it
    Then the table really is partitioned, so the warning keeps meaning something
