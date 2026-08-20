Feature: The trace search query is plain text
  `langwatch trace search -q` matches the query as a phrase. A Lucene-style
  query returns zero rows instead of an error, and zero rows reads like "you
  have none of those", so an agent asked to find failing traces reports that as
  the answer. The command names the cause when it applies.

  @unit
  Scenario: A boolean query that finds nothing says why
    Given a query carrying AND, OR or NOT as a separate word
    When the search returns no traces
    Then the reply says the operators were searched for as words
    And it still suggests widening the date range

  @unit
  Scenario: A plain query that finds nothing does not blame the operators
    Given a query of one plain phrase
    When the search returns no traces
    Then only the ordinary empty-state advice appears
