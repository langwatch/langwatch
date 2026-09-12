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

    A finished run that still owes evaluator results is stored with the status
    PENDING_EVALUATION instead, the same way a scheduled run is stored QUEUED.
    The stored status is the only truth: nothing derives it when the run is
    read, and no clock is involved. The judge's verdict, reasoning and criteria
    are stored as they were decided. When the evaluated event records the
    results, the gate writes the terminal status: a required evaluator that
    failed or errored fails the run, otherwise the judge's status stands.

    The evaluation job records a result for every attachment on its final
    attempt, so the evaluated event normally always arrives. The one gap is a
    job lost outright, a wiped queue or a worker that died with no retry. The
    run execution process manager covers it: a run that finishes owing results
    arms a deadline, and if no evaluated event has landed when it passes, one
    errored result per evaluator is recorded, so a required evaluator that
    never ran fails the run instead of leaving it pending for good.

  # --- The stored status ---

  @unit
  Scenario: A finished run whose suite attaches evaluators is stored pending evaluation
    Given a run that finished with the verdict "success"
    And its finished event carries two evaluator attachments
    When the run's state is folded
    Then the stored status is PENDING_EVALUATION
    And the judge's verdict is stored

  @unit
  Scenario: A finished run with no attachments is stored with the judge's status
    Given a run that finished with the verdict "success"
    And its finished event carries no evaluator attachments
    When the run's state is folded
    Then the stored status is SUCCESS

  @unit
  Scenario: A run that sent its own evaluations is stored with the judge's status
    Given a run whose finished results carry evaluations
    And its finished event carries two evaluator attachments
    When the run's state is folded
    Then the stored status is SUCCESS

  @unit
  Scenario: A run that errored or was cancelled is never pending evaluation
    Given a run that finished with the status ERROR and two evaluator attachments
    When the run's state is folded
    Then the stored status is ERROR
    And the same holds for a run that finished CANCELLED

  @unit
  Scenario: Recording the evaluations writes the gated terminal status
    Given a run stored PENDING_EVALUATION with the verdict "success"
    When an evaluated event lands whose evaluators all passed
    Then the stored status is SUCCESS
    And when the evaluated event carries a failed required evaluator instead
    Then the stored status is FAILURE

  @unit
  Scenario: An evaluated event that lands before the finished event settles the run
    Given a run whose evaluated event folded before its finished event
    When the finished event lands carrying two evaluator attachments
    Then the stored status is the judge's, not PENDING_EVALUATION

  @unit
  Scenario: A required failure recorded before the finished event fails the run
    Given a run whose evaluated event, carrying a failed required evaluator, folded before its finished event
    When the finished event lands with the verdict "success"
    Then the stored status is FAILURE with the gated verdict
    And the run is neither PENDING_EVALUATION nor SUCCESS

  # --- What a reader sees ---

  @unit
  Scenario: A pending run reads as PENDING_EVALUATION
    Given a stored run row with the status PENDING_EVALUATION and the verdict "success"
    When the row is mapped to run data
    Then the status reads PENDING_EVALUATION
    And the judge's verdict is still reported

  @unit
  Scenario: A settled run reads with its stored status
    Given a stored run row with the status SUCCESS
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
    Given a stored run with the status PENDING_EVALUATION and the verdict "success"
    When the run and its batch are read back
    Then the run answers the status PENDING_EVALUATION with the judge's verdict
    And the batch counts it as running rather than settled
    And a run stored SUCCESS answers that status and settles

  @integration
  Scenario: The batch and the set aggregates agree on a pending run
    Given a set whose only batch holds one run stored PENDING_EVALUATION
    When the batch summary and the set summaries are read back
    Then the batch counts one running run and no settled run
    And the set counts no settled run and no passed run

  # --- The lost grading job ---

  @unit
  Scenario: A run that finishes owing evaluator results arms the evaluation deadline
    Given the run execution process of a running run
    When the finished event lands carrying two evaluator attachments
    Then the process waits for the evaluators with a wake at the evaluation deadline
    And it keeps the evaluators the run owes

  @unit
  Scenario: A run that finishes owing nothing goes terminal
    Given the run execution process of a running run
    When the finished event lands with no attachments, with its own evaluations, or errored
    Then the process goes terminal and clears its wake

  @unit
  Scenario: The evaluated event ends the wait
    Given the run execution process of a run waiting for its evaluators
    When the evaluated event lands
    Then the process goes terminal and clears its wake

  @unit
  Scenario: A lost grading job is recorded as errored evaluators after the deadline
    Given the run execution process of a run waiting for its evaluators
    When the wake fires after the evaluation deadline with no evaluated event
    Then the process records one errored result per evaluator the run owes
    And the results say the evaluation did not complete
    And the process goes terminal

  @unit
  Scenario: The deadline wake stays armed while the deadline has not passed
    Given the run execution process of a run waiting for its evaluators
    When the wake fires before the evaluation deadline
    Then the process keeps waiting with the same deadline

  @unit
  Scenario: The lost-job results reach the run through the record evaluations command
    Given a record evaluations intent for two evaluators, one required
    When the intent is executed
    Then the record evaluations command receives one errored result per evaluator
    And each result carries the evaluator's name and whether it is required

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

  # --- The values and the definitions the run is graded with ---
  #
  # The attachments say which evaluators run and where each input reads its
  # value. Two more things decide the verdict: the scenario's field values a
  # mapping reads, and the saved evaluator's own definition (its type, its
  # settings, its inputs). Both are pinned with the attachments when the run
  # is queued, so editing a scenario or an evaluator while a batch executes,
  # or between two attempts of the grading job, changes the runs queued after
  # the edit and never the ones already queued.

  @unit
  Scenario: The scenario field values a run is graded with are resolved when it is queued
    Given a queue run command for a scenario that carries "SELECT 1" for golden_sql
    When the command is handled
    Then the queued event carries the field values next to the attachments

  @unit
  Scenario: The evaluator definitions a run is graded with are resolved when it is queued
    Given a queue run command for a scenario whose suite attaches one evaluator
    And that evaluator is saved with the settings it runs with and the inputs it declares
    When the command is handled
    Then the queued event carries the evaluator's definition next to the attachments
    And an attached evaluator the project no longer holds is left out

  @unit
  Scenario: The finished event carries the field values and the definitions the run was queued with
    Given a run queued with field values and evaluator definitions
    And the scenario and the evaluator were edited since
    When the run is finished
    Then the finished event carries the field values and the definitions the run was queued with

  @unit
  Scenario: The evaluation job is queued with the field values and the definitions the run carries
    Given a finished event carrying field values and evaluator definitions
    When the evaluation subscriber handles it
    Then the job payload carries the same field values and definitions

  @unit
  Scenario: A scenario field edited while the batch executes does not change what a queued run is graded against
    Given an evaluation job whose payload carries "SELECT 1" for golden_sql
    And the scenario now carries "SELECT 2" for golden_sql
    When the worker runs
    Then the evaluator reads "SELECT 1" for the field

  @unit
  Scenario: An evaluator edited while the batch executes does not change what a queued run is graded against
    Given an evaluation job whose payload carries the evaluator's definition with case sensitive matching
    And the saved evaluator was switched to case insensitive matching since
    When the worker runs
    Then the evaluator runs with case sensitive matching
    And the saved evaluator is not read

  @unit
  Scenario: A job written before the values and the definitions were carried reads them now
    Given an evaluation job whose payload carries attachments but no field values and no definitions
    When the worker runs
    Then it reads the scenario's field values and the saved evaluators
