Feature: Query completeness report

  A LangWatchQL result says how much of the data it read is present, so a dashboard widget
  never shows missing data as zero. The report reads the same view, window and tenants as the
  query, under the same restricted identity and limits.

  Rule: A report rides only on a query bound to a time window

    @unit
    Scenario: A windowed query over traces reports how many traces carry each field it reads
      Given a statement over analytics.traces that follows the dashboard period and reads TotalCost
      And 10 traces in the period, 4 of them with spans whose model had no price
      When the statement runs for a project
      Then the result carries completeness with unit "traces", total 10 and TotalCost present on 6
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

  Rule: Only the columns a result is made of count

    A column counts when the query selects or groups by it. A filter or a sort only picks rows,
    and the report counts every row of the window, so a column named only there would read as
    missing data the result never showed.

    @unit
    Scenario: A column the query only filters or sorts on is not counted
      Given a windowed statement over analytics.traces that selects TopicId
      And filters on TotalCost and sorts on SatisfactionScore
      When the statement runs for a project
      Then completeness counts TopicId only

    @unit
    Scenario: A column whose null is a state is not counted
      Given a windowed statement over analytics.spans that selects and groups by ParentSpanId
      When the statement runs for a project
      Then completeness counts no field, because a null ParentSpanId is a root span

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

    @unit
    Scenario: Week buckets start on Monday, as the dashboard templates bucket them
      Given a statement bucketed by the board granularity over two weeks from a Sunday at one week
      When the statement runs for a project
      Then the report query buckets from Monday
      And completeness lists the Mondays the window touches, starting the Monday before it

  Rule: Cost with no price is reported, not counted as zero

    @unit
    Scenario: A query reading cost reports traces with unpriced spans and their models
      Given a windowed statement over analytics.traces reading TotalCost
      And 2 traces in the period carry spans whose model had no price
      When the statement runs for a project
      Then completeness.unpriced counts 2 traces and names those models, sorted
      And the completeness state is "partial"

    @unit
    Scenario: A trace with no model call has a known cost
      Given a windowed statement over analytics.traces reading TotalCost
      And no trace in the period carries an unpriced span, though some made no model call
      When the statement runs for a project
      Then the report counts a cost as present on every trace without an unpriced span
      And the completeness state is "complete"

    @unit
    Scenario: A cost on a view with no unpriced record is not counted
      Given a windowed statement over analytics.spans reading Cost
      When the statement runs for a project
      Then completeness counts no field and carries no unpriced count

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
