Feature: Export a dashboard widget to CSV

  Every widget with data has "Export CSV" in its menu, on a stored board and on a read-only
  From LangWatch board. One click downloads one file; there is no dialog. The file holds the rows
  the widget's own queries already returned for the board's period, so nothing new is asked of
  the server and a reader never exports a row or a column the widget itself could not show them.
  A widget that draws only the top rows of its query still exports every row the query returned.
  The rules live in modules/analytics/browser/src/features/dashboards/WIDGET_STANDARD.md.

  Rule: A widget with data offers Export CSV

    @integration
    Scenario: A stored board's widget exports the rows its queries returned
      Given a widget named "Spend by model" on the stored board "Weekly review"
      And its query answered with rows for the board's period
      When the reader picks "Export CSV" in the widget's menu
      Then one file downloads, named for the board, the widget and the period
      And it holds the rows the query returned, and no query is run again
      And the reader is told "CSV downloaded"

    @integration
    Scenario: A From LangWatch board's widget has a menu that holds only Export CSV
      Given a widget on a read-only From LangWatch board whose query answered with rows
      When the reader opens the widget's menu
      Then it offers "Export CSV" and nothing that changes the board
      And picking it downloads the file, named for the From LangWatch board

    @integration
    Scenario: Export CSV waits for the widget's data
      Given a widget on a board
      Then "Export CSV" cannot be picked while no query has answered, and says "Still loading"
      And it cannot be picked when the widget failed to load, and says "This widget did not load"
      And it cannot be picked when the period has no traffic, and says "No data in this period"

    @unit
    Scenario: A widget with nothing of its own to export has no Export CSV
      Given a widget with no query, a widget showing its setup view, or a widget the reader may not see
      When the export's state is worked out
      Then the menu has no "Export CSV"
      And a widget whose queries all returned no rows says "No data in this period"

    @integration
    Scenario: A widget the reader may not see has no Export CSV
      Given a widget whose query is refused because the reader lacks "cost:view"
      When the reader opens the widget's menu
      Then it has no "Export CSV"

  Rule: The file holds what the queries returned, for the period on screen

    @unit
    Scenario: One row per result row, under the query's own column names
      Given a query named "main" that returned the columns "model" and "total_cost" over three rows
      When the file's table is written
      Then it has a header row and three rows, in the order the query returned them
      And the first column is "Query" with the query's name, then "model" and "total_cost"

    @unit
    Scenario: Several queries go into one file
      Given a widget whose queries "now" and "before" returned different columns
      When the file's table is written
      Then every row names its query, and the columns are the union of both queries' columns
      And a column a query did not return is empty on that query's rows

    @unit
    Scenario: Numbers stay plain and a missing value stays empty
      Given rows holding a cost of 830.12, a count of 12000, a null, a NaN and an empty text
      When the file's table is written
      Then the numbers are written as 830.12 and 12000, with no currency sign and no separator
      And the null, the NaN and the empty text are empty cells, never 0

    @unit
    Scenario: Dates are ISO instants in UTC
      Given a DateTime column holding "2026-10-01 00:00:00" and a Date column holding "2026-10-01"
      When the file's table is written
      Then both read "2026-10-01T00:00:00Z"
      And a column in a named time zone other than UTC keeps the text the query returned

    @unit
    Scenario: Every row carries the period it was read over
      Given a query that follows the board's period and one that reads outside it
      When the file's table is written
      Then the last two columns are "Period start (UTC)" and "Period end (UTC)"
      And the first query's rows carry the period as ISO instants, the end being the first instant after it
      And the second query's rows leave both empty

    @unit
    Scenario: The file is named for the board, the widget and the period's days
      Given the board "Running costs", the widget "Spend" and a period from 2026-10-01 to the end of 2026-10-07 in UTC
      When the file is named
      Then it is "running-costs_spend_query-results_2026-10-01_2026-10-07.csv"
      And a widget with no query over the board's period leaves the days out

    @integration
    Scenario: The file opens cleanly in a spreadsheet
      Given rows with an accented model name, a text with a comma and a quote, and a text starting with "="
      When the reader exports the widget
      Then the file starts with a UTF-8 byte order mark and has one line per row
      And the text with a comma and a quote is quoted, and the text starting with "=" is not run as a formula

    @integration
    Scenario: A result at the row limit says rows may be missing
      Given a widget whose query returned exactly the 10,000 rows one request may return
      When the reader exports the widget
      Then the file downloads and the reader is told a query hit the 10,000-row limit, so rows may be missing

    @unit
    Scenario: A file is written with a byte order mark only when the caller asks
      Given the shared CSV download writer
      When a caller asks for a byte order mark
      Then the file starts with one, and a caller that does not ask gets the bytes it got before
