Feature: A langevals evaluation waits only on its own work
  langevals hid other libraries' progress bars behind a 0.1 s pause before every
  batch and every single call. On a server nobody reads those bars, so the pause
  was the largest part of a fast evaluator's response time.
  Plan: dev/docs/plans/langevals-go-replacement.md §13.4.

  @unit
  Scenario: A batch evaluation does not pause before it starts
    Given an evaluator that answers instantly
    When it evaluates a batch of entries
    Then no fixed pause is taken

  @unit
  Scenario: A single evaluation does not pause before it starts
    Given an evaluator that answers instantly
    When it evaluates one entry
    Then no fixed pause is taken
