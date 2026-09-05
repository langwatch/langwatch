Feature: A run reports that its evaluators have not run yet
  As a person or a machine waiting on the result of a scenario run
  I want a run whose required evaluators are still queued to say so
  So that nothing reports a green run that a required evaluator is about to fail

  Background: why the state exists.
    The judge's verdict is written when the run finishes; the evaluators the
    suite and the run plan attach are graded afterwards by a queued job, which
    retries while the trace is still arriving. Between the two, the run held a
    terminal status, so the CLI wait, the run endpoints and the results page
    could all read it as passed and then watch a required evaluator turn it
    red.

    A finished run that still owes evaluator results reads with the status
    PENDING_EVALUATION instead. The stored status stays the terminal one the
    judge decided, so nothing about recovery changes; the pending status is
    derived when the run is read, and it lasts until the results are recorded
    or until the grace period after the run finished runs out, so a job that
    never completes cannot hold a run open forever.

  # --- The pending state ---

  @unit
  Scenario: A finished run whose suite attaches evaluators is pending evaluation
    Given a run that finished with the verdict "success"
    And its finished event carries two evaluator attachments
    When the run's state is folded
    Then the run awaits evaluation

  @unit
  Scenario: A finished run with no attachments is not pending evaluation
    Given a run that finished with the verdict "success"
    And its finished event carries no evaluator attachments
    When the run's state is folded
    Then the run does not await evaluation

  @unit
  Scenario: A run that sent its own evaluations is not pending evaluation
    Given a run whose finished results carry evaluations
    And its finished event carries two evaluator attachments
    When the run's state is folded
    Then the run does not await evaluation

  @unit
  Scenario: A run that errored or was cancelled is not pending evaluation
    Given a run that finished with the status ERROR and two evaluator attachments
    When the run's state is folded
    Then the run does not await evaluation
    And the same holds for a run that finished CANCELLED

  @unit
  Scenario: Recording the evaluations clears the pending state
    Given a run that awaits evaluation
    When an evaluated event lands
    Then the run no longer awaits evaluation

  # --- What a reader sees ---

  @unit
  Scenario: A pending run reads as PENDING_EVALUATION
    Given a stored run row that finished as SUCCESS and awaits evaluation
    When the row is mapped to run data
    Then the status reads PENDING_EVALUATION
    And the judge's verdict is still reported

  @unit
  Scenario: The pending status expires so a lost job cannot hold a run open
    Given a stored run row that awaits evaluation and finished longer ago than the grace period
    When the row is mapped to run data
    Then the status reads SUCCESS

  @unit
  Scenario: A run that never awaited evaluation reads with its own status
    Given a stored run row that finished as SUCCESS and does not await evaluation
    When the row is mapped to run data
    Then the status reads SUCCESS

  @unit
  Scenario: The results page draws a pending run as still going
    Given the status configuration of a scenario run
    Then PENDING_EVALUATION is not complete and reads as "evaluating"
    And it carries an icon like every other status

  @unit
  Scenario: The command line wait does not count a pending run as finished
    Given a batch of two runs, one SUCCESS and one PENDING_EVALUATION
    When the wait tallies the batch
    Then one run counts as completed and the batch is not over

  @integration
  Scenario: A run with attached evaluators reads as pending until they are recorded
    Given a stored run that finished as SUCCESS and owes its evaluator results
    When the run and its batch are read back
    Then the run answers the status PENDING_EVALUATION with the judge's verdict
    And the batch counts it as running rather than settled
    And a run whose results are recorded answers its graded status and settles

  # --- What the run is graded against ---

  @unit
  Scenario: The evaluators a run is graded with are resolved when it is queued
    Given a queue run command for a scenario whose suite attaches one evaluator
    When the command is handled
    Then the queued event carries that attachment

  @unit
  Scenario: The finished event carries the attachments the run was queued with
    Given a run queued with one attachment whose suite now attaches a different one
    When the run is finished
    Then the finished event carries the attachment the run was queued with

  @unit
  Scenario: A run with no queued attachments resolves them when it finishes
    Given a run whose events carry no attachments, started from code
    When the run is finished
    Then the finished event carries the attachments its suite attaches now

  @unit
  Scenario: The evaluation job is queued with the attachments the run carries
    Given a finished event carrying two attachments
    When the evaluation subscriber handles it
    Then the job payload carries those two attachments
    And the suite and the run plan are not read again

  @unit
  Scenario: The worker grades a run with the attachments its job carries
    Given an evaluation job whose payload carries one attachment
    And a suite that now attaches a different evaluator
    When the worker runs
    Then it grades the run with the attachment the job carried

  @unit
  Scenario: A retry grades the run with the same attachments as the first attempt
    Given an evaluation job that retried because the trace had not arrived
    When the retry runs
    Then it carries the attachments of the first attempt
