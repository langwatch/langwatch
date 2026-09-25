Feature: A migration run is not failed by its own output
  Every ClickHouse migration runs verbose, so goose prints a line per
  statement and the output grows with the migration count. A child process
  killed for printing too much reports the same way as a migration that could
  not apply, which sends the reader to the schema instead of to the buffer.

  @unit
  Scenario: A run whose output passes a megabyte still succeeds
    Given a child process that prints more than one megabyte
    When it is run with the buffer the migrations use
    Then the whole output is captured and no error is reported

  @unit
  Scenario: A run cut off by the buffer says so
    Given a child process killed with ENOBUFS
    When the failure is turned into an operator message
    Then the message names the buffer and says the run cannot report on the migrations

  @unit
  Scenario: A missing goose binary still says how to install it
    Given a child process that could not start because the binary is absent
    When the failure is turned into an operator message
    Then the message names the goose install page
