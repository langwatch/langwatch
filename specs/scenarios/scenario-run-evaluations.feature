Feature: Evaluator results on scenario runs
  As a person who reads the results of a scenario run
  I want the run to carry one result per evaluator that ran on it
  So that a run can fail on a check the judge does not make, and I can read why.

  Background: where the results come from.
    A test suite or a run plan attaches evaluators to its scenarios. After a
    run finishes, the platform runs each evaluator on the mapped inputs and
    records one result per evaluator on the run. A scenario run from code can
    run its evaluators itself and send the results with its finished event,
    in which case the platform stores them as sent and does not run them again.

    A result names the evaluator, its status (passed, failed, scored, skipped
    or error), whether it is required, and the details of what happened. A
    required evaluator that failed or errored fails the run: the verdict turns
    to failure and the run status reads as failed. The judge's reasoning and
    its met and unmet criteria stay as the judge wrote them. A score-only
    evaluator and a skipped one never change the verdict.

  @unit
  Scenario: The evaluation result schema round-trips every field
    Given an evaluation result with a status, a required flag, a pass, a score, a label, details, a cost and inputs
    When it is parsed by the scenario evaluation result schema
    Then every field reads back as given
    And a result that carries only the required fields also parses

  @unit
  Scenario: The evaluation result schema refuses a status that contradicts passed
    Given an evaluation result whose status is "passed" and whose passed flag is false
    When it is parsed by the scenario evaluation result schema
    Then the result is refused

  @unit
  Scenario: Finished results carry evaluations
    Given a finished event whose results carry two evaluations
    When the event is folded
    Then the run stores both evaluations in order
    And a finished event without evaluations stores none

  @unit
  Scenario: A required evaluator that failed turns the verdict to failure
    Given a run that finished with the verdict "success"
    When an evaluated event arrives with a required evaluation that failed
    Then the run reads the verdict "failure" and the status FAILURE
    And the judge's reasoning and criteria are unchanged
    And the run keeps its finish time

  @unit
  Scenario: An evaluator that is not required never changes the verdict
    Given a run that finished with the verdict "success"
    When an evaluated event arrives with a failed evaluation that is not required
    Then the run keeps the verdict "success" and the status SUCCESS
    And the run stores the evaluation

  @unit
  Scenario: The gate reads only required failures and errors
    Given evaluations that are skipped, scored and passed
    Then the gated verdict is the judge's verdict
    And a required evaluation with the status "error" turns the gated verdict to failure

  @unit
  Scenario: A run the judge never graded stays ungraded even with a required failure
    Given a required evaluation that failed and a judge that produced no verdict
    Then the gated verdict stays ungraded instead of reading as a failure

  @unit
  Scenario: Recording evaluations on a run that has not finished is refused
    Given a run that was queued and started but not finished
    When evaluations are recorded on it
    Then the command is refused

  @unit
  Scenario: Recording evaluations carries the verdict the run held before
    Given a run that finished with the verdict "success"
    When evaluations with a required failure are recorded
    Then the evaluated event says the run held "success" before and holds "failure" now
    And the event carries the run's scenario, batch and set ids

  @unit
  Scenario: Recording the same evaluations twice records one event
    Given evaluations already recorded on a run
    When the same evaluations are recorded again
    Then the second event carries the same idempotency key
    And different evaluations carry a different key, so the second call replaces the first

  @unit
  Scenario: A suite run recounts when an evaluated event changes the verdict
    Given a suite run whose item completed with the status SUCCESS and the verdict "success"
    When the item is regraded to the status FAILURE and the verdict "failure"
    Then the suite run counts one failed item and no passed item
    And an evaluated event that changes nothing dispatches no regrade

  @unit
  Scenario: The UI is told when a run is evaluated
    Given a connected results page
    When an evaluated event lands
    Then the page is told the run changed so it reads the run again

  @integration
  Scenario: Code-run results with evaluations are stored as sent and read back typed
    Given a run whose finished results carry evaluations with every field set
    When the run is stored and read back
    Then the evaluations read back with the same fields, in the same order
    And a run without evaluations reads back with none

  @unit
  Scenario: A stored run maps its evaluations onto its results
    Given a stored run row whose evaluation columns hold two evaluators
    When the row is mapped to run data
    Then the results carry both evaluations typed
    And a row with no evaluation columns maps to results without evaluations
