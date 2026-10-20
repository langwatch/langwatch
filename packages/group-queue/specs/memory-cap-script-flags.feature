Feature: Queue scripts at the Redis memory cap
  As the queue running on a Redis with a memory cap and no eviction
  I want a script that adds data to be refused whole at the cap, and a script that frees memory to run
  So that a script never half-applies at the ceiling and the queue still drains (Alex, 2026-10-20)

  Every queue Lua script declares Redis 7 script flags on its first line. A script that adds data
  (staging, retry re-stage, redrive, lease writes) declares `#!lua`, which Redis refuses before it
  runs while memory is over the cap. A script the queue needs to drain (claim, complete, drain,
  dead-letter, sweeps, reaper deletes) declares `#!lua flags=allow-oom` and always runs.
  Read-only scripts declare `#!lua flags=no-writes`.

  Background:
    Given a GroupQueue's staging scripts on a real Redis whose eviction policy is noeviction

  @integration
  Scenario: At the memory cap a staging script is refused whole and leaves nothing behind
    Given a group already holding one staged job
    And Redis memory is over its cap
    When a second job is staged into the group
    Then the stage is refused with an out-of-memory error
    And every queue key is exactly as it was before the stage

  @integration
  Scenario: At the memory cap a job is still claimed and completed, freeing its keys
    Given a group holding one staged job
    And Redis memory is over its cap
    When a worker claims the job and completes it
    Then the claim and the completion both succeed
    And the group's jobs, payload, active and claimed keys are gone
