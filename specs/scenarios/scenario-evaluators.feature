Feature: Evaluators run on scenario runs
  As a person who attaches evaluators to a test suite or a run plan
  I want the platform to run them after every scenario run and record one result each
  So that a scenario can fail on a check the judge does not make, and I can read why

  Background: how a run is evaluated.
    When a scenario run finishes, the platform reads the evaluators attached to
    the scenario's test suite and to the run plan the run was filed under. Each
    evaluator input reads its value through a mapping: the conversation (first
    user message, last agent message, transcript, messages), the scenario (its
    situation, its criteria, one of the suite's fields), the trace the run
    produced (a tool call's input or output, the retrieved contexts), or a
    literal value.

    The work runs as a queued job, one per run, retried with a growing delay
    while the trace is still arriving. Each evaluator produces one result:
    passed, failed, scored, skipped or error, with details. The results are
    recorded on the run through the record evaluations command, which applies
    the gate (see specs/scenarios/scenario-run-evaluations.feature), and each
    evaluation that ran is also written on the run's last trace so it shows in
    the trace drawer.

  # --- Golden path ---

  @integration
  Scenario: A finished run with attached evaluators is graded on the platform
    Given a test suite with the field golden_sql and an exact match evaluator attached
    And the evaluator maps output to the last agent message and expected_output to golden_sql
    And a scenario in the suite that carries "SELECT 1" for golden_sql
    When a run of that scenario finishes with the agent answering "SELECT 1"
    Then the run's evaluation job is queued once
    And the evaluator runs with output "SELECT 1" and expected_output "SELECT 1"
    And the run records one passed result for the evaluator with its resolved inputs
    And the evaluation is reported on the run's last trace

  @unit
  Scenario: Conversation mappings read the messages of the run
    Given a run whose messages are a user turn, an agent turn, a user turn and an agent turn
    Then first_user_message reads the first user turn
    And last_agent_message reads the last agent turn
    And transcript reads every turn as "role: content" lines
    And messages reads the turns as JSON

  @unit
  Scenario: Scenario mappings read the situation, the criteria and a field
    Given a scenario with a situation, two criteria and the field golden_sql set
    Then situation reads the situation
    And criteria reads the criteria joined by a newline
    And fields.golden_sql reads the field value as text

  @unit
  Scenario: Trace mappings read tool calls and retrieved contexts
    Given spans with two run_sql tool calls and one rag span with two contexts
    Then tool_calls.run_sql.input reads the input of the last run_sql call
    And tool_calls.run_sql.output reads the output of the last run_sql call
    And contexts reads the text of every retrieved context

  @unit
  Scenario: A literal mapping reads its value
    Given an evaluator input mapped to the value "42"
    Then the input reads "42"

  @unit
  Scenario: A score-only result is recorded as scored
    Given an evaluator result with a score and no pass
    Then the run records a scored result with that score
    And a result with passed true records passed, and passed false records failed

  @unit
  Scenario: A result with no label and no details is recorded without them
    Given an evaluator result whose label and details are null
    Then the run records the result with neither a label nor details

  @unit
  Scenario: Stored inputs are cut to two thousand characters
    Given a resolved input longer than two thousand characters
    Then the recorded result stores the first two thousand characters of it
    And the evaluator still reads the whole value

  # --- Failure paths ---

  @unit
  Scenario: A blank scenario field skips the evaluator with a reason
    Given an evaluator that maps expected_output to the field golden_sql
    And a scenario that carries no value for golden_sql
    When the run is evaluated
    Then the evaluator does not run
    And the run records a skipped result with the details "no golden_sql on this scenario"

  @unit
  Scenario: A tool call the trace does not hold fails the evaluator with a reason
    Given an evaluator that maps output to tool_calls.run_sql.input
    And a trace with no run_sql call
    When the run is evaluated on its last attempt
    Then the evaluator does not run
    And the run records a failed result with the details "no run_sql call in the trace"

  @unit
  Scenario: Retrieved contexts the trace does not hold fail the evaluator with a reason
    Given an evaluator that maps contexts to the trace contexts
    And a trace with no rag span
    When the run is evaluated on its last attempt
    Then the run records a failed result with the details "no retrieved contexts in the trace"

  @unit
  Scenario: An optional input the trace cannot give is left out
    Given a score judge whose optional contexts input maps to the trace contexts
    And a trace with no rag span
    When the run is evaluated
    Then the judge runs without contexts
    And the result is not failed for the missing contexts

  @unit
  Scenario: Trace data that has not arrived yet is retried with a growing delay
    Given an evaluator that reads the trace
    And the run's spans have not arrived
    When the evaluation job runs
    Then nothing is recorded while the trace is still arriving
    And a failed result is recorded once the retries run out

  @unit
  Scenario: An evaluator error is recorded as an error result
    Given an evaluator whose run reports an error
    When the run is evaluated
    Then the run records an error result with the error details
    And the other evaluators of the run still record their results

  @unit
  Scenario: An evaluator the project no longer holds is recorded as an error
    Given an attachment naming an evaluator id the project does not have
    When the run is evaluated
    Then the run records an error result that says the evaluator was not found

  @unit
  Scenario: A trace report failure does not lose a graded result
    Given an evaluator that passes and a trace that fails to record the result
    When the run is evaluated
    Then the run still records the passed result

  @unit
  Scenario: A run that carries its own evaluations is not evaluated again
    Given a finished event whose results already carry evaluations
    When the finished event is seen
    Then no evaluation job is queued

  @unit
  Scenario: A run whose suite and plan attach no evaluator queues no job
    Given a finished event for a scenario whose suite has no evaluators
    And a run plan with no evaluators
    When the finished event is seen
    Then no evaluation job is queued

  @unit
  Scenario: A run that ended in an error or a cancellation is not evaluated
    Given a finished event with the status ERROR
    When the finished event is seen
    Then no evaluation job is queued
