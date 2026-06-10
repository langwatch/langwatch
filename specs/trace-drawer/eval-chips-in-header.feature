Feature: Eval chips in the trace drawer header

  The trace drawer header already shows compact chips for service /
  origin / SDK / scenario / prompt. Evaluations only show up far below in
  the trace summary's Evals accordion, so a heavily-evaluated trace
  often looks like nothing happened. Each evaluation result gets its own
  chip in the same chip strip as the prompt chips, reusing the same
  result-pill component the trace list table uses (status dot + name +
  score / pass-fail), but with a styling variant that matches the rest
  of the header chips. Clicking a chip jumps the operator to the Evals
  section so they can read the details without scrolling.

  Scenario: Each evaluation result renders as a header chip
    Given the trace has evaluation results
    When the trace drawer header chip strip renders
    Then there is one chip per evaluation
    And each chip shows the eval's status dot, name, and score / pass-fail
    And the chip styling matches the prompt / SDK chips alongside it

  Scenario: Hovering an eval chip shows its full detail popover
    Given the operator hovers an eval chip
    Then the same popover that the trace list table uses appears
    And the popover shows the eval's full name, score / pass-fail, and any error / explanation

  Scenario: Clicking an eval chip jumps to the Evals accordion
    Given the operator clicks an eval chip
    When they are NOT already on the Trace tab
    Then the drawer switches to the Trace tab
    And the right pane switches to the trace Summary tab
    And the Evals accordion expands
    And the pane scrolls so the Evals section is in view

  Scenario: Clicking an eval chip when already on the right tabs
    Given the operator is already on the Trace tab and the Summary tab
    When the operator clicks an eval chip
    Then the Evals accordion expands if it was collapsed
    And the pane scrolls so the Evals section is in view

  Scenario: No eval chips render when the trace has no evaluations
    Given the trace has zero evaluation results
    When the trace drawer header chip strip renders
    Then no eval chips are present
    And the rest of the header is unchanged
