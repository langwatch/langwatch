Feature: Finding failed traces from the CLI
  "Show me my failed traces" has no text to search for: an error is recorded on
  the span, not in the trace's indexed text, so `-q "error"` returns nothing and
  reads like a clean project. `--errors-only` asks the platform the question
  directly. The text query itself is matched as one phrase, and a query
  carrying AND, OR or NOT returns zero rows rather than an error, so the empty
  result names that cause when it applies.

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

  @unit
  Scenario: Search only traces that contain an error
    Given the user wants the traces that failed
    When they search with the errors-only flag
    Then the search asks the platform for traces containing an error
    And it does not depend on the word "error" appearing in the trace text

  @unit
  Scenario: Combine the error filter with an origin filter
    When the user asks for failed traces from one origin
    Then both filters reach the platform
    And neither one replaces the other
