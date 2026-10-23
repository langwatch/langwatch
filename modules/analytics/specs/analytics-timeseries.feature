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

    @unit @regression
    Scenario: Feedback and top-document reads ignore the toolbar's search and negation
      Given the analytics toolbar sends a search query and negated filters with the shared filters
      When the Analytics service reads feedbacks and top documents
      Then both reads succeed instead of refusing the extra fields
      And the repository receives only the project, date range and filters

  Rule: Read the feedback history one bounded page at a time

    @unit
    Scenario: The first page is the newest feedbacks and says whether the history goes on
      Given a project with more feedbacks than one page holds
      When the Analytics service reads the first page
      Then it returns the newest feedbacks up to the page size
      And it returns a cursor for the next page

    @unit
    Scenario: Following the cursors reads every feedback once, newest first
      Given a project whose feedbacks include several with the same timestamp
      When the pages are read by following each cursor to the end
      Then every feedback appears exactly once in the order of the unpaged read
      And the last page carries no cursor

    @unit
    Scenario: A history that fits one page, or is empty, has no next page
      Given a project with fewer feedbacks than one page, or none
      When the Analytics service reads the first page
      Then it returns those feedbacks and no cursor

    @unit
    Scenario: A feedback added or removed between pages neither repeats nor skips another
      Given the first page of a project's feedbacks has been read
      When a newer feedback is added and the feedback the cursor stopped after is removed
      Then the next page continues after the same place without a repeat or a gap

    @unit @regression
    Scenario: A cursor from another project or another filter set is refused
      Given a cursor issued for one project and filter set
      When it is used for a different project or different filters
      Then the Analytics service refuses with validation_error naming the cursor
      And the repository is never asked for feedbacks

    @unit
    Scenario: A malformed cursor or an out-of-range page size is refused
      Given a feedbacks page request with an incomplete cursor or a page size outside the bounds
      When the request is checked
      Then it is refused before any read

    @unit
    Scenario: The feedback page read needs the same permission as the feedback read
      Given the analytics tRPC contract and its server half
      When the feedback and feedback page procedures are read
      Then both are queries guarded by cost:view

    @unit
    Scenario: The paged query orders by a persisted identity and resumes strictly after the cursor
      Given a feedbacks page query with and without a cursor
      Then it orders by timestamp, trace, span and event position, all descending
      And it asks for one row more than the page size
      And the cursor position and the tenant are bound parameters, never interpolated

    @unit
    Scenario: The existing feedback read keeps its query and result
      Given the existing feedbacks read
      When the page read is added
      Then the existing query still takes the newest 100 by timestamp and returns only events

  Rule: Refuse a series its metric cannot aggregate, before any read (#8013)

    @unit @regression
    Scenario: A series with an aggregation its metric does not support is refused
      Given a project timeseries query sums the evaluation runs metric, which only counts
      When the Analytics service executes it
      Then it refuses with validation_error naming the metric's allowed aggregations
      And the repository is never asked for the timeseries

    @unit
    Scenario: A series naming a metric outside the analytics registry is refused
      Given a project timeseries query names a metric the analytics registry does not define
      When the Analytics service executes it
      Then it refuses with validation_error on that series' metric field
      And the repository is never asked for the timeseries

    @unit
    Scenario: The browser's metric registry offers exactly the aggregations the service accepts
      Given the browser's analytics metric registry and the contract's metric aggregations
      When every metric's allowed aggregations are compared
      Then both name the same metrics with the same aggregations

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

  Rule: Compare the routed read with the legacy read only where the tripwire is on

    @unit
    Scenario: A project with the read tripwire on is also read from the legacy table
      Given the analytics read tripwire flag is on for the project
      And a timeseries query is routed to the trace analytics rollup
      When the Analytics service executes it
      Then the trace analytics rollup and the legacy trace summaries table are both read
      And the routed result is returned whatever the legacy table says

    @unit
    Scenario: A project with the read tripwire off is read only from the routed table
      Given the analytics read tripwire flag is off for the project
      And a timeseries query is routed to the trace analytics rollup
      When the Analytics service executes it
      Then only the trace analytics rollup is read

    @unit
    Scenario: An aggregate's series is not compared with the legacy tables
      Given the analytics read tripwire flag is on for an aggregate project
      And the series is read under a proof that opens a member project
      When the Analytics service executes it
      Then only the routed table is read

    @unit
    Scenario: A routed result that diverges from the legacy result is logged
      Given the routed and legacy results disagree beyond the tolerance on one metric
      When the tripwire compares them
      Then a warning names the project, the table and the diverging metric
      And no warning is logged when the two agree

  Rule: Read every series under a proof (ADR-177)

    @unit
    Scenario: A series asked without a proof reads its own project alone
      Given a caller with no proof, such as a scheduled report, asks for a project's series
      When the Analytics service executes it
      Then the series is read under a proof the platform mints for that project alone

    @unit
    Scenario: Callers with different grants on one aggregate do not share a cached series
      Given two callers ask for the same series on one aggregate project
      And one caller's proof opens a member project the other's does not
      When the Analytics service executes both
      Then each caller's series is read under its own proof

    @unit
    Scenario: A series asked under another project's proof is refused
      Given a proof minted for one project
      When a series for a different project is read under it
      Then nothing is read and the read is refused

    @unit
    Scenario: A cached series is not served under an expired proof
      Given a series already cached for a project
      When the same series is asked again under a proof that has expired
      Then the repeat is refused and the cache does not answer it

    @unit
    Scenario: A trace summaries series leaves its tenants to the proof
      Given a series the router sends to the trace summaries table
      When its statement is built
      Then it carries the proof's marker and names no tenant of its own

  Rule: Keep feature ownership narrow

    @unit
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

  Rule: Analytics counts the same traces the Trace Explorer lists

    @integration
    Scenario: Langy's own turns are left out of every Analytics read
      Given a project whose traces include turns with origin "langy"
      When the Analytics page reads for a window
      Then every read excludes the origin "langy"
      And the Traces total equals the Trace Explorer count for the same window

    @integration
    Scenario: A personal project's Analytics reads keep Langy's turns
      Given a personal project, where Langy's conversations are the member's own data
      When the Analytics page reads for a window
      Then no read excludes any origin
