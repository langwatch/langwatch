Feature: Comparison error handling

  Background:
    Given an Experiments Workbench has a Comparison target
    And the Comparison target uses an LLM judge model

  @unit
  Scenario: Judge auth failures are serialized as domain errors
    When the judge call fails with a 403 missing authentication token error
    Then the evaluator result includes a domain error with kind "evaluator_execution_error"
    And the domain error meta includes httpStatus 403
    And the raw provider response remains available in the result details

  @integration
  Scenario: The Comparison cell renders a friendly auth failure
    Given a Comparison cell result contains an evaluator execution domain error with httpStatus 403
    When the cell renders the error
    Then it shows "Missing or invalid model API key"
    And it shows the AI Gateway configuration hint
    And it does not dump the raw status-code response as the headline

  # ==========================================================================
  # Phase 2 - what a comparison judges, waits for, and refuses to judge
  # ==========================================================================

  @unit
  Scenario: A comparison waits for every column it compares
    Given a comparison over two columns
    When only one column has answered a row
    Then no comparison runs for that row
    And the row says which column it is waiting on
    And the comparison runs once every column has answered

  @unit
  Scenario: A comparison reports only the rows the run was scoped to
    Given a comparison over two columns and a dataset of several rows
    When the run is scoped to one row and that row is still waiting on a column
    Then only that row reports what it is waiting on
    And the rows outside the run say nothing

  @unit
  Scenario: A comparison refuses to judge a column with nothing to compare
    Given a comparison over two columns
    When one column's answer is empty, or the output field picked for it is gone
    Then no comparison runs for that row
    And the row names the column whose answer it could not read
    And the judge reads the picked field's own value when that field is there

  @unit
  Scenario: A comparison shows the judge the scores a column already earned
    Given a column that has already been scored by its own evaluators
    When the comparison builds that row's candidates
    Then the column's scores are appended to that column's candidate only
    And they are appended to the picked output field, not the whole answer
    And a row whose answer is empty is skipped rather than sent as scores alone

  @unit
  Scenario: A comparison column dispatches the shape its judge expects
    Given a comparison that is its own column
    When the judge behind it compares any number of candidates
    Then the whole candidate list is dispatched
    And when the judge behind it is the legacy two-column one
    Then the two candidate slots that judge reads are dispatched instead

  @unit
  Scenario: A comparison that judges no golden answer sends none
    Given a comparison configured not to judge against a golden answer
    And a golden column is still picked from an earlier configuration
    When the comparison builds a row
    Then no golden answer is dispatched to the judge

  @unit
  Scenario: Two columns running one prompt are still told apart
    Given two columns running the same prompt
    When the comparison builds a row
    Then each candidate is identified by its own column
    And a row waiting on one of them names it with a numbered name, not an internal id
