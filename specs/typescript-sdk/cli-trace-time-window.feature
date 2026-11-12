Feature: Trace reads in the CLI find what an agent saw without guessing flags
  An agent that saw a trace yesterday or last month asks for it in words, not
  epoch milliseconds. Every trace read takes the same windows, defaults to the
  same week, and an empty answer says what was searched and how to widen it.

  @unit
  Scenario: A lookback, a calendar word or a local date is a window bound
    When I pass --start-date as "7d", "yesterday" or "2026-11-10"
    Then the bound is that long ago, local midnight of yesterday, or local midnight of that date

  @unit
  Scenario: A trace read with no window reads the last 7 days
    When I run `langwatch trace search` with no window
    Then it searches the last 7 days

  @unit
  Scenario: An empty default search widens once to 30 days and says so
    Given nothing matched in the last 7 days
    When I run `langwatch trace search` with no window
    Then it searches the last 30 days once
    And the output says the window was widened

  @unit
  Scenario: An empty search names what was searched and the command to widen it
    Given nothing matched even after widening
    When I run `langwatch trace search --format json`
    Then the document names the project, the window, the query and the filters
    And it carries the exact command that reads further back

  @unit
  Scenario: An empty export says what it read on stderr and keeps stdout the file
    Given no trace matches the export window
    When I run `langwatch trace export`
    Then stderr says what was read and how to export further back
