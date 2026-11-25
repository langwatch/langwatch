Feature: A listed run's jobs coalesce like any other jobs
  As the queue an upgrade's background steps and migration passes send their work through
  I want jobs sent on a listed run to fold into one handler call exactly as jobs sent outside one do
  So that a run over a backed-up group stores once per batch rather than once per job, with no
  exception for listed work (Alex, 2026-10-12: one path for every job, consistency first)

  A queue that opts into coalescing drains a claimed group's due siblings into one handler call.
  The batch runs under the claimed job's dispatch scope, so only siblings sent under that same
  scope join it: a sibling from another run, or from outside any run, is put back and runs on its
  own, and the jobs each one causes stay on its own list.

  Background:
    Given a GroupQueue with its Lua scripts deployed, coalescing up to 50 jobs per call
    And a listed consumer

  @integration
  Scenario: Jobs a listed run sends to one group run as one batch
    Given a listed run that sends ten jobs to one group in one batch
    When the listed consumer claims the group
    Then the jobs reach the handler in fewer calls than there are jobs, at least one holding several
    And every job runs exactly once
    And the run returns once they have all run

  @integration
  Scenario: A job from outside the run is never folded into the run's batch
    Given a group holding an older job sent outside any run
    And a listed run that sends five jobs to that group
    When the listed consumer claims the group
    Then the older job runs on its own
    And the run's five jobs run in batches holding only the run's jobs
    And the run returns once its jobs have run
