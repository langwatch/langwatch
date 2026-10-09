Feature: Running LangWatchQL from the CLI

  As an agent or an engineer at a terminal
  I want to run a LangWatchQL statement and get the rows
  So that I can answer an analytical question, and export the answer

  LangWatchQL reached the CLI only through a saved chart (`langwatch chart run`),
  which means a statement had to be saved in the product before it could be run.
  `langwatch query` runs a statement as written, with the same verbatim contract
  the REST door has: the statement the database runs is the statement submitted.

  The export case is what shapes the flags. A post-training pull wants one JSON
  object per row, JSON-typed columns parsed back into real arrays, and paging
  that does not rewrite the caller's SQL. `--format jsonl` and `--page-by keyset`
  are those two things.

  Background:
    Given credentials that resolve to a project holding "analytics:view"

  # ---------------------------------------------------------------------------
  # Running a statement
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A statement given as an argument is sent as written
    When the caller runs a statement as the command's argument
    Then the request carries that statement unchanged

  @unit
  Scenario: A statement can come from a file
    When the caller runs the command with a statement file
    Then the request carries the file's contents unchanged

  @unit
  Scenario: A statement and a statement file together are refused
    When the caller gives both a statement argument and a statement file
    Then the command refuses before making a request

  @unit
  Scenario: Bound parameters are passed through
    When the caller repeats the parameter flag twice
    Then the request carries both parameters

  @unit
  Scenario: A parameter without a value is refused
    When the caller gives a parameter flag with no equals sign
    Then the command refuses before making a request

  @unit
  Scenario: The period flags fill the statement's reserved window parameters
    When the caller gives a start and an end
    Then the request carries them as the time window

  @unit
  Scenario: A start without an end is refused
    When the caller gives only a start
    Then the command refuses before making a request

  @unit
  Scenario: The row limit is applied to what is printed
    When the caller asks for fewer rows than the result carries
    Then only that many rows are printed

  # ---------------------------------------------------------------------------
  # Formats
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The table format prints the result's own columns
    When the caller runs a statement with the default format
    Then the printed table's headers are the result's column names

  @unit
  Scenario: The jsonl format prints one object per row
    When the caller runs a statement with the jsonl format
    Then each line is one row as a JSON object

  @unit
  Scenario: A JSON-typed column arrives as a value, not as a string
    Given a result column whose type is a JSON string
    When the caller runs a statement with the jsonl format
    Then that column's value on each line is the parsed value

  @unit
  Scenario: The csv format writes a header row and escapes the values
    When the caller runs a statement with the csv format
    Then the first line is the column names
    And a value containing a comma, a quote or a newline is quoted and escaped

  @unit
  Scenario: The output file flag writes the result instead of printing it
    When the caller gives an output file
    Then the file holds the formatted result and nothing is printed to standard output

  # ---------------------------------------------------------------------------
  # Keyset paging
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Keyset paging rebinds the cursor parameters between pages
    Given a statement declaring the two keyset cursor parameters
    When the caller asks for keyset paging
    Then each page after the first binds the cursor to the last row of the page before it
    And the statement text is identical on every page

  @unit
  Scenario: Keyset paging stops when a page comes back short
    When a page returns fewer rows than the page before it asked for
    Then no further page is requested

  @unit
  Scenario: Keyset paging refuses a statement that does not declare the cursor parameters
    Given a statement with no keyset cursor parameters
    When the caller asks for keyset paging
    Then the command refuses and names the two parameters the statement must declare

  # ---------------------------------------------------------------------------
  # Discovery subcommands
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The schema subcommand prints the views and their columns
    When the caller runs the schema subcommand
    Then it prints each dataset with its columns, types and availability

  @unit
  Scenario: The reference subcommand prints the whole reference
    When the caller runs the reference subcommand
    Then it prints the LangWatchQL section, the trace filter section, the examples and the decision table

  @unit
  Scenario: The reference subcommand can print one section
    When the caller runs the reference subcommand for one section
    Then only that section is printed

  @unit
  Scenario: The examples subcommand prints the example library
    When the caller runs the examples subcommand
    Then it prints every example with its identifier, intent and statement

  @unit
  Scenario: The examples subcommand filters by tag and by language
    When the caller runs the examples subcommand with a tag and a language
    Then only the examples carrying that tag in that language are printed

  # ---------------------------------------------------------------------------
  # Registration
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The query family stays off the CLI's boot graph
    When the CLI entry point's static imports are walked
    Then no query command module is reachable

  @unit
  Scenario: The query family is claimed by the feature map
    When the CLI's command tree is compared with the feature map
    Then every query command the CLI registers is declared

  @unit
  Scenario: The row limit bounds the whole keyset walk, not each page
    Given a keyset statement whose pages are larger than the row limit
    When the walk runs
    Then it writes the limit once, across every page together

  @unit
  Scenario: A keyset statement that does not project its cursor columns is refused
    Given a keyset statement projecting neither cursor column
    When the walk reads its first page
    Then the command refuses rather than guessing the cursor from the row
