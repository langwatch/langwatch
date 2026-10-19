Feature: The trace explorer says what its table and drawer are doing

  @integration
  Scenario: A link into edit mode starts the correction on that trace
    Given a link to a trace drawer that asks for edit mode
    When the page opens on it
    Then a correction starts on that trace
    And the drawer is in edit mode

  @integration
  Scenario: A registered run resets the new-count baseline
    Given the trace table counting new traces
    When a run registers behind an eval chip
    Then the new-count baseline is reset
    And the next count is not compared against another context

  @unit
  Scenario: An empty table during a run says matches are still coming
    Given an Instant Eval that is still judging
    When the table has no rows yet
    Then it says there are no matches yet
    And it does not claim that nothing matches

  @unit
  Scenario: An empty table under an unjudged chip says these results are not judged
    Given an eval chip with no run for this window
    When the table has no rows
    Then it says these results are not judged
    And it does not claim that nothing matches
