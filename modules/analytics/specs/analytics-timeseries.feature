Feature: Analytics timeseries service

  Rule: Keep all Analytics reads on one service boundary

    @unit
    Scenario: Feedback reads preserve their existing result shape
      Given a project feedback query with its date range and filters
      When the Analytics service executes it
      Then it returns the existing events result without transport-specific mapping

    @unit
    Scenario: Top-document reads preserve their existing result shape
      Given a project top-document query with its date range and filters
      When the Analytics service executes it
      Then it returns the existing topDocuments and totalUniqueDocuments fields

  Rule: Route analytics reads conservatively

    @unit
    Scenario: Additive trace metrics use the trace rollup
      Given a project timeseries query contains an additive performance metric
      When the Analytics service executes it
      Then the repository receives the trace analytics rollup table
      And the project id is passed as the tenant id

    @unit
    Scenario: Unsafe query shapes use the legacy trace table
      Given a project timeseries query contains explicit trace ids
      When the Analytics service executes it
      Then the repository receives the trace summaries table

    @unit
    Scenario: Oversized requests are bounded
      Given a query would produce more than 1000 minute buckets
      When the Analytics service executes it
      Then the repository receives a daily adjusted timescale

  Rule: Keep feature ownership narrow

    Scenario: Analytics does not own product lifecycles
      Given Dashboard owns saved charts and Topic owns clustering
      When those features need timeseries data
      Then they consume the Analytics service
      And Analytics owns no Dashboard or Topic repository

  Rule: Persist evaluation analytics through Analytics

    @unit
    Scenario: Evaluation projections use the canonical Analytics persistence capability
      Given an Evaluation projection has derived an evaluation analytics row
      When it writes the row or its rollup
      Then Analytics validates and persists the current table shape

    @unit
    Scenario: ClickHouse-disabled processes preserve evaluation projection no-ops
      Given ClickHouse is disabled for a process
      When an Evaluation projection writes or reads evaluation analytics
      Then Analytics does not resolve a ClickHouse client
      And the read returns no row

  Rule: A period-over-period read compares against the window immediately before

    @unit
    Scenario: The comparison window is the same length as the window it precedes
      Given a requested window of a whole number of days
      When the comparison window is taken
      Then it begins exactly that many days before the requested window, counting the days the calendar actually has

    @unit
    Scenario: A comparison window walks back across a year end
      Given a requested window early in January
      When the comparison window is taken
      Then it begins in December of the year before

    @unit
    Scenario: A comparison window is always a whole number of days
      Given a datapoint step shorter than a day
      When the comparison window is taken, including for a window handed over end first
      Then it walks back a whole day rather than failing on a fraction of one
