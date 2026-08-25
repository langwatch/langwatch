Feature: Analytics timeseries service

  Rule: Keep all Analytics reads on one service boundary

    Scenario: Feedback reads preserve their existing result shape
      Given a project feedback query with its date range and filters
      When the Analytics service executes it
      Then it returns the existing events result without transport-specific mapping

    Scenario: Top-document reads preserve their existing result shape
      Given a project top-document query with its date range and filters
      When the Analytics service executes it
      Then it returns the existing topDocuments and totalUniqueDocuments fields

  Rule: Route analytics reads conservatively

    Scenario: Additive trace metrics use the trace rollup
      Given a project timeseries query contains an additive performance metric
      When the Analytics service executes it
      Then the repository receives the trace analytics rollup table
      And the project id is passed as the tenant id

    Scenario: Unsafe query shapes use the legacy trace table
      Given a project timeseries query contains explicit trace ids
      When the Analytics service executes it
      Then the repository receives the trace summaries table

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
