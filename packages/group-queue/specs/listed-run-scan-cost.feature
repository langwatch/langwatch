Feature: A listed run's dispatch costs Redis little however many groups wait
  As the queue an upgrade's background steps and migration passes send their work through
  I want each claim over a listed run to look at a waiting group at most once, and to pass over
  the groups already running
  So that one Redis, shared by every worker replica, is not held for tens of milliseconds per
  claim while a run's groups are in flight (a 200,000-user upgrade spent half of Redis's time in
  this scan)

  The listed consumer finds work by walking the run's candidates, re-scoring each group it looks
  at. A claim reads only candidates scored before its own clock, so each one it looks at leaves
  that window and is never read twice in one claim. A group already running is scored a second
  ahead, so claims in that second pass it by; when its job completes and the group still holds
  work, the completion scores it back to that work's due time, so it runs next without waiting
  out the second. A group holding work it can't run yet (parked at its tenant's cap, blocked, or
  paused) is scored five seconds ahead: looking at it on every claim kept the listed consumer
  polling every 50ms over a 155,000-group parked backlog. A listed run's claim never unparks
  groups past the tenant cap, since its scan only runs the run's own groups.

  Background:
    Given a GroupQueue with its Lua scripts deployed
    And a listed run whose groups are registered as its candidates

  @integration
  Scenario: A claim passes over a group already running until its job completes
    Given a listed run's group whose job a claim has dispatched
    And a second job staged for that group while the first runs
    When another claim runs within the second
    Then it dispatches nothing and leaves the running group's candidate score as it was
    When the first job completes
    Then the group's candidate score is the second job's due time
    And the next claim dispatches the second job

  @integration
  Scenario: A claim leaves a group parked at its tenant's cap out of the next claims
    Given a tenant capped at one job in flight, with two groups in a listed run
    When a claim dispatches the first group and parks the second
    Then the parked group's candidate score is more than a second ahead

  @integration
  Scenario: A claim leaves a blocked group out of the next claims
    Given a listed run's group that is blocked
    When a claim runs
    Then it dispatches nothing
    And the blocked group's candidate score is more than a second ahead

  @integration
  Scenario: A claim over a listed run leaves other tenants' parked groups parked
    Given a tenant at its cap with a group parked, outside the listed run
    And a global budget, so the work-conserving override is on
    When a claim over the listed run dispatches its group with slots to spare
    Then the other tenant's group is still parked

  @integration
  Scenario: A claim with fewer due groups than free slots looks at each waiting group once
    Given a listed run with 100 groups whose jobs are all due later
    When a claim with one free slot runs
    Then it dispatches nothing
    And it looks at each of the 100 groups once, not the same groups again until its scan budget

  @integration
  Scenario: A listed run's group gets its next job about a second after a job sent outside the run
    Given a listed run's group holding a job sent outside the run, then a job sent under the run
    And the listed consumer runs the outside job, whose completion knows no listed run
    When the outside job completes
    Then the listed consumer claims the run's job within about a second and a half
    And does not wait out its full idle poll

  @integration
  Scenario: A job that succeeds clears its group's failure streak and retry attempt
    Given a group with a recorded failure streak and retry attempt
    When the group's next job is dispatched and completes successfully
    Then the group's failure streak and retry attempt are both gone
