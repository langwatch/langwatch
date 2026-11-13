Feature: Each evaluation's outcome is kept beside its trace's columns

  The stock widgets that join an evaluation to its trace read trace_evaluation_analytics: one live
  row per evaluation, its trace's columns copied byte for byte from trace_analytics. The outcome
  is recorded on the trace, the trace analytics fold keeps it, and the rows are written collapsing
  so readers sum Sign and never need FINAL. Why: modules/trace/adrs/003.

  @unit
  Scenario: An evaluation's outcome is recorded on its trace
    Given a stored trace and a reported evaluation of it
    When the trace subscriber handles the report
    Then a recordEvaluationOutcome command names the trace, stamped with the trace's OccurredAt
    And its idempotency key names the evaluation event

  @unit
  Scenario: A completed evaluation takes its identity from evaluation's run
    Given a stored trace and an evaluation run on it that has just completed
    When the trace subscriber handles the completion
    Then the recorded outcome carries the run's evaluator name and guardrail flag

  @unit
  Scenario: An evaluation of a trace not stored yet is retried within the wait
    Given an evaluation whose trace is not stored, appended at most an hour ago
    When the trace subscriber handles it
    Then no outcome is recorded
    And the delivery fails so the queue retries it

  @unit
  Scenario: An evaluation of a trace still not stored after the wait records nothing
    Given an evaluation whose trace is not stored, appended over an hour ago
    When the trace subscriber handles it
    Then no outcome is recorded and the skip is logged

  @unit
  Scenario: The fresher outcome of an evaluation wins
    Given a trace whose fold holds an evaluation's outcome
    When an older outcome of the same evaluation arrives after it
    Then the fold keeps the fresher outcome

  @unit
  Scenario: An outsized evaluator name and label are truncated
    Given a stored trace and a reported evaluation whose evaluator name and label exceed 256 characters
    When the trace subscriber handles the report
    Then the recorded name and label are each truncated to 256 characters

  @unit
  Scenario: An evaluation time far from its trace is clamped
    Given a stored trace and a reported evaluation timed a year ahead of now or ten days before the trace
    When the trace subscriber handles the report
    Then the recorded evaluation time is clamped to now plus five minutes or one day before the trace

  @unit
  Scenario: A trace's fold refuses a new evaluation past 200 and keeps every one it holds
    Given a trace whose fold holds 200 evaluations' outcomes, each with its row written
    When an outcome of a 201st evaluation arrives
    Then the fold and the live rows still hold the same 200 evaluations
    And a fresher outcome of an evaluation it holds still replaces the old one

  @unit
  Scenario: A cached fold state flipped back writes the original row again
    Given a trace whose fold state is held in the fold cache after each store
    When its evaluation's outcome changes from A to B and back to A
    Then exactly one evaluation row is live, carrying A's content

  @unit
  Scenario: A new evaluation writes one row
    Given a trace with no evaluation rows
    When its fold stores a first outcome
    Then the evaluation's row is written once at revision 1
    And the trace row records the digest of the rows it left

  @unit
  Scenario: A copied trace column change writes a retraction pair
    Given a trace whose evaluation row is stored
    When the trace's topic changes and the fold stores again
    Then the stored row is written again with sign -1 and its own revision
    And the new row is written with sign +1 and the next revision
    And one row is live, carrying the new topic

  @unit
  Scenario: Unchanged rows write nothing
    Given a trace whose evaluation rows match its folded state
    When the fold stores again with nothing changed
    Then no evaluation row is written and no live row is read

  @unit
  Scenario: A live group whose signs sum to -1 writes no repair +1
    Given an evaluation whose current row is live and whose old content reads as a group summing to -1
    When the fold diffs its wanted rows against those live rows
    Then no evaluation row is written

  @unit
  Scenario: A live group whose signs sum to 2 writes no extra -1
    Given an evaluation whose current row reads as one group summing to 2
    When the fold diffs its wanted rows against those live rows
    Then no evaluation row is written
    And a change of that row writes one -1 for it and the new row at the next revision

  @unit
  Scenario: A crash between the two writes heals
    Given an evaluation row written whose trace row write was lost
    When the fold stores the same state again
    Then no evaluation row is written again
    And the trace row records the rows' digest

  @unit
  Scenario: Unreadable stored outcomes are rebuilt from the trace's events, never stored over
    Given a trace row whose stored evaluation outcomes do not decode
    When the fold reads that row back
    Then the read reports the row undecodable rather than a state with no outcomes
    And the fold rebuilds the trace from its events instead of storing over the row

  @unit
  Scenario: Evaluation rows keep async inserts and plain reads while the quorum flag is off
    Given the evaluation analytics quorum flag is off, its default
    When evaluation rows are written and the live rows are read back
    Then the insert is asynchronous and the read carries no extra settings

  @unit
  Scenario: Evaluation rows are written by quorum and read sequentially while the quorum flag is on
    Given the evaluation analytics quorum flag is on
    When evaluation rows are written and the live rows are read back
    Then the insert is synchronous by quorum and the read is sequentially consistent

  @unit
  Scenario: A replay from scratch writes no duplicate
    Given a trace whose evaluation rows are stored
    When a replay folds the trace again from no state
    Then no evaluation row is written again

  @unit
  Scenario: The backfill records each recent outcome on its trace once
    Given a project with finished evaluations of the last 62 days on stored traces
    When the record step runs
    Then each outcome is sent once, keyed by its evaluation id and stamped with its trace's OccurredAt
