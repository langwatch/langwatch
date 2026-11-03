Feature: A claim's bookkeeping in few round trips
  As the LangWatch worker draining a backed-up queue
  I want a batch's completions, retries and lease renewals to share one round trip,
  and the poison guard's claim marker to ride the claim and its outcome
  So that a job waits on Redis as few times as its guarantees allow

  # Every group keeps its own claim token, so a stale outcome is fenced alone, and its own
  # answer, so one failure fails only its own group. The claim marker is written by the
  # dispatch script only while the claiming worker's beacon is alive, and released by every
  # outcome script only when this worker still owns it; a death is still counted only when
  # the previous owner publishes neither alive nor retired (poison-group-park-guard.feature).

  @integration
  Scenario: A batch's completions leave in one round trip, each fenced by its own claim
    Given sixteen claimed groups, one of them recovered by another worker
    When their completions are sent together
    Then fifteen groups complete
    And the recovered group's new claim is left untouched

  @integration
  Scenario: A batch's retries leave in one round trip, each fenced by its own claim
    Given claimed groups failing together, one of them recovered by another worker
    When their retries are sent together
    Then every owned group is re-staged with its retry chain advanced
    And the recovered group is not re-staged

  @integration
  Scenario: Every live group's lease in a batch is renewed in one round trip
    Given claimed groups whose leases are about to lapse
    When the batch's heartbeat fires
    Then every owned group's lease is renewed
    And a group another worker recovered is not renewed

  @unit
  Scenario: A lone completion goes alone and completions issued together share one call
    Given completions finishing in the same turn of the event loop
    When they are sent
    Then they leave in one call and each caller gets its own answer
    And a completion finishing alone is sent exactly as before

  @integration
  Scenario: The claim marker is written with the claim once the worker's beacon is alive
    Given a worker whose liveness beacon is alive
    When it claims a group
    Then the claim marker names it
    And the claim answers with the group's confirmed deaths

  @integration
  Scenario: A claim made without a live beacon writes no marker
    Given a worker whose liveness beacon is missing
    When it claims a group
    Then no claim marker is written

  @integration
  Scenario: Every outcome releases only a marker this worker still owns
    Given two groups claimed by one worker, one of whose markers another worker now owns
    When both complete
    Then the worker's own marker is released
    And the other owner's marker and death count are left intact

  @integration
  Scenario: A group is still parked after three confirmed deaths
    Given a group whose last three claimants died without retiring
    When a worker claims it again
    Then the group is parked before its job runs
    And its job stays staged

  @integration
  Scenario: An old and a new worker share the claim markers and drain one queue
    Given a worker that records and releases markers in their own round trips
    And a worker that records them with the claim and releases them with the outcome
    When both drain the same queue
    Then every job runs once and each group's jobs run in order
    And no group is parked and no death is counted

  # A script's cost is mostly the Redis commands it issues, so a claim and its drain read and
  # write each key no more often than their guarantees need (dev/docs/plans/redis-queue-perf.md,
  # P2a and P3). The claimed record, its token and the original scores are unchanged.

  @integration
  Scenario: A claim reads each claimed job's body once
    Given ready groups of one handler and one tenant, beside a group of a paused handler
    When a worker claims them as one cross-group batch
    Then each examined group's body is read once
    And each claimed group's record holds its body and original score under its token
    And the paused handler's group is parked unclaimed
    And after the worker dies the next claims get the same bodies back

  @integration
  Scenario: A group that cannot join any open batch is not read
    Given a full set of slots whose only open batch belongs to one tenant
    When the scan meets ready groups of another tenant
    Then their bodies are not read and they stay ready

  @integration
  Scenario: A claimed job whose body is missing is looked up once
    Given a ready group whose head job has lost its body
    When a worker claims it as part of a cross-group batch
    Then the body is looked up once
    And the job is claimed with an empty body and no recovery copy

  @integration
  Scenario: Draining siblings into a claim writes each key once
    Given a claimed group with six due siblings
    When they are drained into the claim
    Then each sibling's body is read once
    And the staged jobs, their bodies, the counter and the claimed record each take one write
