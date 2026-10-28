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
  Scenario: A drained sibling whose body is gone leaves the group without a recovery copy
    Given a claimed group whose middle sibling has lost its body
    When the siblings are drained into the claim
    Then every sibling leaves the group and the total-pending counter
    And the claimed record holds the siblings that had a body, with their original scores

  @integration
  Scenario: A drain stops at the first sibling that would overflow the byte budget
    Given a claimed group whose second sibling would push the batch past its byte budget
    When the siblings are drained into the claim
    Then only the first sibling joins the claim
    And the later siblings stay staged in order, still counted as pending, even one small enough to fit

  @integration
  Scenario: A drain too large for one write is held whole and comes back in order
    Given a claimed group with more due siblings than one write carries
    When they are all drained into the claim and the worker dies
    Then the claimed record held every sibling's body and original score
    And the next claim brings every job back in its original order with the counter conserved

  @integration
  Scenario: A previous-release worker's drain writes nothing into the claimed record
    Given a claim whose worker drains siblings without a claim token
    When the siblings are drained
    Then they leave the group and the total-pending counter
    And the claimed record holds only the claimed job

  @integration
  Scenario: A slow former owner's completion does not double-complete
    Given a worker whose active key lapsed while it was still running a job
    And a second worker that has recovered the job and is running it
    When the first worker finishes and completes
    Then its completion changes nothing and reports the claim as lost
    And the second worker's active key and claimed record survive
    And the second worker's completion frees the group, counted once

  @integration
  Scenario: A late outcome from a worker's own earlier claim leaves its newer claim alone
    Given a worker whose claim on a group lapsed and which then claimed the group again
    When the outcome of its earlier claim arrives late, as a completion, a retry or a block
    Then each is refused as a lost claim
    And the newer claim's poison-guard marker, death count, counters and claimed bodies are as they were
    And the newer claim's own completion still releases the marker

  @unit
  Scenario: A former owner that dead-letters or parks a recovered job leaves the group alone
    Given a worker whose claim was recovered by another worker
    When it dead-letters its job after exhausted retries, or parks its group as poison
    Then it neither clears the group's failure streak nor its attempt count
    And it releases no claim marker and counts no exhausted job or parked group

  @integration
  Scenario: A former owner's dead-letter and re-stage leave the recovering worker's state alone
    Given a worker whose claim, with a drained sibling, was recovered by a second worker
    And the second worker has claimed the job again and drained the sibling into its batch
    When the first worker dead-letters its job or a staged sibling, or re-stages its drained sibling
    Then each write is refused as a lost claim and changes nothing
    And the second worker's claimed record, active key and staged jobs are as they were

  @integration
  Scenario: A former owner's failure keeps the payload lease the recovering worker relies on
    Given a job whose payload is offloaded to the blob store under a lease
    And a worker whose claim on it was recovered by a second worker while its handler ran
    When the first worker's handler fails for good and it blocks or dead-letters the job
    Then the lease the recovered job carries is still held
    And the payload blob keeps its full lifetime instead of the release grace window
    And no payload is reported dead, since the recovering worker runs the job

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

  @integration
  Scenario: A dead-lettered job is not brought back by a later claim
    Given a worker that dead-letters the job it claimed
    When it dies before completing the slot and the group is claimed again
    Then the job stays in the dead-letter queue and is not claimed again

  @integration
  Scenario: Draining a group throws away a dead worker's claimed jobs
    Given a group whose claimed record was left by a worker that died
    When an operator drains the group
    Then the claimed record is gone with the group's staged jobs
    And nothing is left for the next claim of the group to put back

  @integration
  Scenario: Moving a group to the dead-letter queue carries a dead worker's claimed jobs with it
    Given a group whose claimed record was left by a worker that died, and one staged job
    When an operator moves the group to the dead-letter queue
    Then the dead-letter queue holds the claimed jobs and the staged job, in order
    And the claimed record is gone

  @unit
  Scenario: A projection replay waits for a group holding a claimed record
    Given a projection group with no active key but a claimed record left by a worker that died
    When a replay waits for the projection's in-flight jobs to drain
    Then it treats the group as in flight until the claimed record is gone

  Rule: A worker that is gone loses its claim when its beacon does, not when its active key does
    The active key outlives a dead worker by up to its whole TTL, and the poison guard counts a
    death the moment the owner's beacon is missing. A claimed group comes up for dispatch every
    recheck interval while it is held; the scan then reclaims it if the claim marker for that very
    claim names an owner with no beacon at all. An owner that is alive or retired keeps its claim
    until the active key lapses, since a retiring worker is still draining. A live owner stalled
    longer than the beacon's lifetime loses its claim too: at-least-once delivery runs the job
    again, and the stalled owner's outcome is refused as a lost claim.

    @integration
    Scenario: A group whose worker's beacon is gone is reclaimed before its active key lapses
      Given a worker that claims a job with its beacon alive and then dies
      When its beacon is gone while its active key still has most of its life left
      And the group comes up for dispatch
      Then a live worker runs the job again without waiting for the active key
      And the death is counted once by the poison guard
      And the dead claim no longer counts against its tenant's in-flight cap

    @integration
    Scenario: A group held by a live worker is neither reclaimed nor parked when it comes up
      Given a worker with its beacon alive that holds a claimed group of a tenant at its in-flight cap
      When the group comes up for dispatch
      Then the claim keeps its active key and claimed record
      And the group is not parked, and comes up again within the recheck interval

    @integration
    Scenario: A retired worker's claim waits for its active key
      Given a worker that retired while it still held a claimed group
      When the group comes up for dispatch
      Then the claim keeps its active key

    @integration
    Scenario: A marker left by an earlier claim does not reclaim a newer one
      Given a group whose claim marker names a dead worker from an earlier claim
      And a newer claim of the group made without a marker of its own
      When the group comes up for dispatch
      Then the newer claim keeps its active key

    @integration
    Scenario: A held group comes up for dispatch within the recheck interval
      Given a worker that claims a group with a long active key
      When it claims the group, and again when its heartbeat refreshes the claim
      Then the group's ready score is no later than the recheck interval from then
