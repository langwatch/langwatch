Feature: The stock widgets that ran out of memory read no map and no FINAL
  On a project with about 2M traces a month, 39 stock widget queries ran out of memory (code 241)
  because every view reads its table with FINAL and a key read of a map carries the whole map
  through the merge. They read typed columns the trace module's projections write instead: the
  trace_analytics fold writes the metadata keys, and a span map projection writes span_analytics,
  which the span_metrics view exposes. The views they read keep each row's latest version with a
  sort-key-ordered LIMIT 1 BY instead of FINAL; span_metrics, whose spans are written once, needs
  neither. Why: modules/analytics/adrs/004 and 006.

  @unit
  Scenario: No rewritten stock query reads a map
    Given the 39 stock queries that ran out of memory
    Then none reads a key of Attributes, SpanAttributes or ResourceAttributes
    And only ck-top-ask, for the traces it shows, and the loop widgets read captured input

  @unit
  Scenario: The new columns are exposed under their tables' access rules
    Given the metadata columns on trace_analytics and the span_analytics columns
    Then trace_metrics and span_metrics expose each from its own source column
    And span_metrics exposes no input hash, as the analytics views expose no captured content

  @unit
  Scenario: The span widgets read span_metrics, not spans
    Given the stock span widgets
    Then each reads span_metrics
    And only the 90-day presence checks and the loop widgets still read spans

  @unit
  Scenario: The trace fold writes the metadata keys the stock widgets read
    Given a trace whose attributes carry the metadata keys the stock widgets group by
    When the trace_analytics fold projects it
    Then each metadata column holds its key's value, and '' when the key is absent

  @unit
  Scenario: The fold never inserts a column the database computes
    Given a trace whose attributes carry metadata keys that goose 00126 made MATERIALIZED columns
    When the trace_analytics fold writes its row
    Then the insert names none of the MATERIALIZED columns and names the plain ones

  @integration
  Scenario: The fold's real insert lets the database compute the metadata columns
    Given a trace whose attributes carry the nine MATERIALIZED keys and the three plain ones
    When the trace_analytics fold inserts its row into the migrated table
    Then the insert succeeds without ILLEGAL_COLUMN
    And the nine computed columns hold the attribute values and the plain ones hold the fold's

  @unit
  Scenario: The trace fold reads metadata.env when metadata.environment is absent
    Given a trace with metadata.env but no metadata.environment
    When the trace_analytics fold projects it
    Then MetadataEnvironment holds the metadata.env value

  @unit
  Scenario: The span projection computes the five span columns
    Given a span with a span type, an exception type, RAG contexts, an input and a deployment environment
    When the span_analytics projection maps it
    Then it writes the span type, the error type, the context count, a hash of the input and the environment
    And a span with no input hashes to 0

  @unit
  Scenario: The span projection reads error.type when exception.type is absent
    Given a span with error.type but no exception.type
    When the span_analytics projection maps it
    Then ErrorType holds the error.type value

  @unit
  Scenario: The views the stock widgets read keep each row's latest version without FINAL
    Given the eight views the stock widgets read that pin latest-in-order
    When their statements are rendered
    Then none reads its table with FINAL
    And each groups by its table's sort key and keeps every other column from the latest version
    And a version tie is broken by the row's Version

  @unit
  Scenario: span_metrics reads its map projection with no dedup
    Given the span_metrics view over the spanAnalytics map projection, which writes each span once
    When its statement is rendered
    Then it reads span_analytics with neither FINAL nor LIMIT 1 BY

  @unit
  Scenario: Every other view keeps the shipped FINAL
    Given a view not pinned to latest-in-order
    When its statement is rendered
    Then it reads its table with FINAL as before

  @integration
  Scenario: The latest-in-order views return the rows the FINAL views returned
    Given rows with several versions, duplicates, a replayed row that ties on UpdatedAt with a
      higher Version, and a trace whose anchor moved to another partition
    When each pinned view is read in its FINAL form and in its latest-in-order form
    Then neither returns a row the other does not

  @unit
  Scenario: The span widgets' floor is the replay step's recorded since
    Given the step that fills span_analytics from the last 62 days
    When it is done
    Then the span widgets' floor is the instant it recorded replaying from
    And while it runs, the floor is the instant it started
    And on a fresh install, where the step is not needed, there is no floor

  @unit @integration
  Scenario: A span widget says its history is still being rebuilt before the replay starts
    Given a widget that reads span_metrics
    And the ledger records no span replay yet, or one not yet started
    When the widget is shown for any period
    Then the widget shows "Span history is still being rebuilt"

  @unit @integration
  Scenario: A span widget whose period starts before the span data says where it starts
    Given a widget that reads span_metrics and a recorded span floor
    When the widget's period starts before the floor
    Then the widget shows "Span data from" and the floor's day

  @unit @integration
  Scenario: A span widget whose period starts after the floor shows no notice
    Given a widget that reads span_metrics and a recorded span floor
    When the widget's period starts at or after the floor
    Then the widget shows no span data notice

  @integration
  Scenario: Each of the 39 rewritten stock queries returns the rows main's form returned
    Given traces, spans and evaluations of each source on the shipped migrations and views
    When every stock query runs in main's form on the FINAL views and in its shipped form on the
      shipped views, under each source list
    Then both return the same rows

  @integration
  Scenario: The loops queries are compared with main's loops query without its arbitrary cap
    Given main capped its loops and its retries at 10000 rows each with no order, so which rows it kept was arbitrary
    And the shipped loops queries drop that cap on purpose
    When the shipped loops queries and main's loops query with the cap removed run under each source list
    Then both return the same rows

  @integration
  Scenario: A trace with a second trace_metrics row later in the period counts once
    Given a trace whose anchor moved before the freeze, so it has two trace_metrics rows in the period
    When the rewritten queries run
    Then every query returns main's rows
    But the topics table counts the trace's rows, not the trace, in its requests and checks

  @integration
  Scenario: A sent outcome whose trace moved into the period counts in the period
    Given a trace that began before the period, whose second trace_metrics row is inside it
    When the outcome and capability-gap queries run
    Then they count the trace by its first row inside the window, so it counts in the period
    And every other rewritten query returns main's rows
