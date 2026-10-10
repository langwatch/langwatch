Feature: Shared list-page composition
  @integration
  Scenario: A list distinguishes loading, empty and failed reads
    Given a list page awaiting its first records
    Then a skeleton replaces the rows
    When the read is empty or fails
    Then the supplied empty or error state replaces the rows

  @integration
  Scenario: Refreshing a list retains records and controlled paging
    Given a populated list refreshing its records
    Then the records stay visible with a refreshing status
    When the reader changes page
    Then the feature receives the requested page
