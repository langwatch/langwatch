Feature: Dashboard widgets never show missing data as zero

  A widget's query result carries the server's completeness report into the sandboxed frame,
  and the helpers widget code is built from keep a missing value as a gap. A count may be a real
  0; a rate, average, percentile or cost with no data is a gap, drawn as a break, never as 0.

  Rule: The completeness report reaches widget code

    @unit
    Scenario: The widget's query result carries completeness to the frame
      Given a query result with a completeness report
      When the host maps it to what crosses the frame's port
      Then the report crosses as a plain copy, and a result without one carries none

    @unit
    Scenario: useChartQuery returns completeness with its rows
      Given a widget that reads a query with LW.useChartQuery
      When the query answers with rows and a completeness report
      Then the hook returns the report beside the rows, and null before the first load

    @unit
    Scenario: A failed refresh keeps the completeness of the rows on screen
      Given a widget whose query answered with rows and a completeness report
      When a refetch fails
      Then the hook keeps the rows and their report, and reports the failure apart

  Rule: A missing value stays missing on the way to the screen

    @unit
    Scenario: The charts library keeps a missing value as null
      Given a value that is null, undefined, NaN or empty
      When the charts library reads it as a number
      Then it reads null, while a real 0 reads 0

    @unit
    Scenario: Template number helpers keep a missing value as a gap
      Given the number helpers every template widget carries
      When they read, sum, divide or format a missing value
      Then the result is null or a dash, never 0 or $0.00

    @unit
    Scenario: A leaderboard row with no value draws no bar and sorts last
      Given a leaderboard over rows where one has no value
      When it renders
      Then that row sorts last with no bar and a dash for its figure

    @unit
    Scenario: A heatmap cell with no data is a gap unless the series counts
      Given a heatmap whose data has no row for a cell
      When it renders as a measure
      Then the cell is drawn empty, and as a count it is drawn as 0

  Rule: Every bucket of the window is on the chart

    @unit
    Scenario: Empty buckets from the report are merged into the rows
      Given rows for the middle bucket of a three-bucket window and the report's bucket list
      When the chart helper merges them
      Then the first and last buckets are present, a measure null and a count 0

    @unit
    Scenario: A measure gap breaks the line with a faint dashed bridge
      Given a time chart whose measure has no value in the middle bucket
      When it renders
      Then a dashed bridge joins the buckets either side, and a stacked chart draws none

    @unit
    Scenario: The hover over a gap says there is no data
      Given a time chart with a bucket where no series has a value
      When the reader hovers that bucket
      Then the hover says "No data on Oct 7", or the widget's own words when it gives them

    @unit
    Scenario: A big number never averages in empty buckets
      Given per-bucket averages where one bucket has no value
      When the chart helper averages them, weighted by each bucket's rows
      Then the empty bucket counts for nothing, and with no value at all the result is null

    @unit
    Scenario: The charts library reads instants without the Temporal polyfill
      Given ISO instants with a zone offset, and ones that are not instants
      When the charts library reads them
      Then each reads as the same epoch milliseconds Temporal gives, and the others read as none

  Rule: Cost with no price is not $0

    @unit
    Scenario: A sum is a lower bound when some rows lack its field or its price
      Given a partial report where cost is on every trace but some traces have no price
      When widget code asks whether the cost sum is a lower bound
      Then it is, while a complete report or a fully present field is not

    @unit
    Scenario: A cost leaderboard lists an unpriced model with no price
      Given a cost leaderboard and the report's unpriced models
      When it renders
      Then each unpriced model has a "no price" row with a dash for its cost, sorted last

    @unit
    Scenario: Template cost queries never count a missing cost as $0
      Given the template cost widgets' queries
      When they sum trace and evaluator cost
      Then no query turns a missing cost into 0, and a total is null only when nothing is priced
