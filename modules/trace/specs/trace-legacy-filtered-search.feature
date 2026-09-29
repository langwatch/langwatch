Feature: A filtered legacy trace search narrows by Trace's own filter grammar

  POST /api/trace/search and /api/traces/search accept the legacy `filters`
  document, as main did. Trace owns the grammar because it owns the tables the
  conditions read; analytics' filter pickers ask Trace for the same translation.

  @unit
  Scenario: A filtered legacy search answers the filtered traces
    Given a legacy trace search with an errors-only filter
    When the trace list is read
    Then the query carries the error condition and binds no unfiltered read

  @unit
  Scenario: A label filter binds its values as parameters
    Given a legacy trace search filtered by a label
    When the trace list is read
    Then the query narrows by the label through a bound parameter

  @unit
  Scenario: A filter field the grammar does not know is refused, not answered with every trace
    Given a legacy trace search filtered by a field the grammar does not know
    When the trace list is read
    Then the read fails rather than listing the whole project

  @unit
  Scenario: Analytics' filter picker is scoped through Trace's translation
    Given a filter picker asked for one field with other filters selected
    When analytics looks up the picker's options
    Then it asks Trace to translate the other filters and scopes the lookup by the answer
