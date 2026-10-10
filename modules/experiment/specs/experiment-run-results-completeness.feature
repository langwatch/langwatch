Feature: Experiment run results say whether they are whole

  A run reported through the SDK is stored after the fact: every row and every
  verdict is a command on the queue, and the run's finish marker is one more.
  Rows are grouped by dataset row, so the finish marker is not ordered after
  them, and a read taken in between holds part of the run with nothing saying
  so. The SDK knows how many rows and verdicts it reported; it sends those
  counts with the finishing batch, the run keeps them, and every read compares
  what is stored against them.

  @unit
  Scenario: The finishing batch carries the counts the run reported
    Given an SDK batch that reports a finish with 4 rows and 12 verdicts expected
    When the batch is logged
    Then the run is completed with those expected counts

  @unit
  Scenario: A batch with a negative expected count is refused
    Given an SDK batch whose expected verdict count is negative
    When the batch is validated
    Then it is refused as invalid

  @unit
  Scenario: The run keeps the expected counts it was completed with
    Given a run completed with 4 rows and 12 verdicts expected
    When a late start event for the same run is folded
    Then the run still holds 4 rows and 12 verdicts expected

  @unit
  Scenario: A run completed without counts holds none
    Given a run completed by an SDK that reports no counts
    When the completion is folded
    Then the run holds no expected counts

  @integration
  Scenario: A finished run with every reported result stored reads as complete
    Given a finished run that reported 2 rows and 4 verdicts
    And all of them are stored
    When the run's results are read
    Then the answer is complete
    And it counts 2 of 2 rows and 4 of 4 verdicts

  @integration
  Scenario: A finished run still missing verdicts reads as incomplete
    Given a finished run that reported 2 rows and 4 verdicts
    And only 3 verdicts are stored
    When the run's results are read
    Then the answer is not complete
    And it counts 3 of 4 verdicts

  @unit
  Scenario: A run that has not finished reads as incomplete
    Given a run with stored rows and no finish marker
    When its completeness is derived
    Then the answer is not complete

  @unit
  Scenario: A finished run that reported no counts reads as complete with unknown totals
    Given a finished run that holds no expected counts
    When its completeness is derived
    Then the answer is complete
    And the expected counts are unknown

  # Each result was one queue job with a single-row insert for its command and
  # one more for its stored row, on top of the jobs of the evaluation pipeline
  # every verdict is mirrored into. A row's results share one queue group, so a
  # backed-up row now drains both as one multi-row insert.

  @unit
  Scenario: Result commands of a backed-up row are appended together
    Given the experiment run pipeline
    When its result commands are registered
    Then recording a target result and recording an evaluator result both coalesce their appends

  @unit
  Scenario: Queued results of one row are stored with one insert
    Given several results of one run queued for storage
    When they are stored as a batch
    Then one insert carries all of them, each stamped with the retention

  @integration
  Scenario: A batch of results is readable after one bulk write
    Given a batch of target and evaluator results for one run
    When the batch is stored through the run item store
    Then every result of the batch is read back for that run

  @unit
  Scenario: The MCP results tool says when a finished run is still being stored
    Given a finished run whose results answer is not complete
    When the MCP results tool renders it
    Then it says the run is still being stored and how much of it is stored so far
