Feature: GroupQueue brings back a job whose worker died while running it
  As the queue every command, projection and subscriber runs on
  I want a job claimed by a worker that dies to be run again by another worker
  So that delivery is at-least-once even when a pod is killed mid-job, as
  dev/docs/ARCHITECTURE.md promises (Alex, 2026-10-12: fix the queue).

  A claim keeps the job's body, and the bodies of the batch siblings drained with
  it, in the group's claimed record with their original scores, under a token the
  claim alone knows. Completion, retry, hand-back, blocking and dead-lettering
  delete the record. When a later claim finds the group's active key gone and the
  record still there, it puts those jobs back at the front of the group in their
  order before claiming; the poison guard counts the death on that claim. A worker
  that has lost its claim to a recovery finishes nothing: its completion, retry
  and block compare the token and change nothing when it no longer matches.
  Previous-release workers never write or read the record.

  Background:
    Given a GroupQueue with its Lua scripts deployed

  @integration
  Scenario: A job claimed by a worker that dies is run by another worker
    Given a group with two staged jobs
    And a worker that claims the first job and dies without finishing it
    When the dead worker's active key expires and a live worker takes the group
    Then the live worker runs the first job exactly once, then the second
    And the death is counted against the group by the poison guard
    And the total-pending counter returns to zero

  @integration
  Scenario: A batch claimed by a dead worker comes back in order
    Given a group with three staged jobs
    And a worker that claims the first and drains the other two into its batch, then dies
    When its active key expires and the group is claimed again
    Then the three jobs are claimed again in their original order
    And the total-pending counter is conserved through the death and the recovery

  @integration
  Scenario: A slow former owner's completion does not double-complete
    Given a worker whose active key lapsed while it was still running a job
    And a second worker that has recovered the job and is running it
    When the first worker finishes and completes
    Then its completion changes nothing and reports the claim as lost
    And the second worker's active key and claimed record survive
    And the second worker's completion frees the group, counted once

  @integration
  Scenario: A worker that still owns its claim completes it after its active key lapsed
    Given a worker whose active key lapsed but whose job nobody has recovered yet
    When the worker finishes and completes
    Then the job is completed and its claimed record deleted
    And no later claim brings the job back

  @integration
  Scenario: A claimed job that is retried is not brought back a second time
    Given a worker that claims a job and re-stages it for a retry
    When the retry's backoff ends and the group is claimed again
    Then the job is claimed once, not once from the retry and once from the record
    And the total-pending counter is conserved
