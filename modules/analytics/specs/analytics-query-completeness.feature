Feature: Query completeness report

  A LangWatchQL result says how much of the data it read is present, so a dashboard widget
  never shows missing data as zero. The report reads the same view, window and tenants as the
  query, under the same restricted identity and limits.

  Rule: A report rides only on a query bound to a time window

    @unit
    Scenario: A windowed query over traces reports how many traces carry each field it reads
      Given a statement over analytics.traces that follows the dashboard period and reads TotalCost
      And 10 traces in the period, 4 of them with a cost
      When the statement runs for a project
      Then the result carries completeness with unit "traces", total 10 and TotalCost present on 4
      And the completeness state is "partial"

    @unit
    Scenario: A query with no window gets no report
      Given a statement over analytics.traces with no reserved period parameters
      When the statement runs for a project
      Then the result carries no completeness and only the statement reached the database

    @unit
    Scenario: A query over a rollup view gets no report
      Given a statement over analytics.trace_metrics_by_minute that follows the dashboard period
      When the statement runs for a project
      Then the result carries no completeness

    @unit
    Scenario: The report reads under the same tenant capability as the statement
      Given a statement over analytics.traces that follows the dashboard period
      When the statement runs for a project
      Then the report query is sent with the statement's tenant capability and the period bounds

  Rule: The state names what a widget should show

    @unit
    Scenario: No rows in the period is no traffic
      Given a windowed statement over analytics.traces and no traces in the period
      When the statement runs for a project
      Then the completeness state is "no_traffic"

    @unit
    Scenario: A field the query reads that no row carries is missing
      Given a windowed statement over analytics.traces reading TopicId
      And traces in the period, none of them with a topic
      When the statement runs for a project
      Then the completeness state is "missing" and the field label is "topic"

    @unit
    Scenario: Every field present on every row is complete
      Given a windowed statement over analytics.traces reading TotalCost
      And every trace in the period has a cost
      When the statement runs for a project
      Then the completeness state is "complete"

  Rule: A bucketed query gets every bucket of the window

    @unit
    Scenario: Empty buckets at the start and end of the window are listed with n 0
      Given a statement bucketed by the board granularity over a three-day window at one day
      And traces only on the middle day
      When the statement runs for a project
      Then completeness lists three buckets, the first and last with n 0

  Rule: Cost with no price is reported, not counted as zero

    @unit
    Scenario: A query reading cost reports traces with unpriced spans and their models
      Given a windowed statement over analytics.traces reading TotalCost
      And 2 traces in the period carry spans whose model had no price
      When the statement runs for a project
      Then completeness.unpriced counts 2 traces and names those models, sorted
      And the completeness state is "partial"

  Rule: The report never costs the member their rows

    @unit
    Scenario: A failed report leaves the result without completeness
      Given a windowed statement over analytics.traces
      And the report query fails
      When the statement runs for a project
      Then the result carries its rows and no completeness

    @unit
    Scenario: A refused statement sends no report query
      Given a windowed statement whose result exceeds the byte ceiling
      When the statement runs for a project
      Then it is refused and only the statement reached the database
