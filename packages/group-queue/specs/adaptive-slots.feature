Feature: A consumer's slots follow its load
  As the queue every fold and command runs through
  I want the number of jobs a consumer runs at once to grow while they wait on IO and shrink under pressure
  So that a small pod's idle CPU is used and a loaded pod backs off before it stalls

  The configured concurrency (GLOBAL_QUEUE_CONCURRENCY, 100 by default) is the floor: a consumer
  starts there and never runs fewer. Slots adapt only up to a ceiling the deployment raises
  with GLOBAL_QUEUE_CONCURRENCY_CEILING (the queue policy's adaptiveSlotsCeiling); by default the
  ceiling is the configured concurrency, so the count stays fixed (Alex, 2026-10-20). A ceiling
  that is not a whole number at least the configured concurrency is refused at boot by name.
  With a raised ceiling, once a second
  the consumer looks at its own process: with every slot taken and the event loop under 85% busy,
  the jobs are waiting on ClickHouse and Redis, so the count grows by a quarter up to the ceiling.
  Above 95% loop or 80% of the heap limit it shrinks by a fifth.

  @integration
  Scenario: By default a consumer's slots stay at its configured concurrency
    Given a consumer configured for two jobs at once with no ceiling raised
    And a backlog of jobs that each wait on IO
    When every slot stays taken while the event loop is idle
    Then it never runs more than two jobs at once

  @integration
  Scenario: A consumer whose jobs wait on IO grows its slots up to a raised ceiling
    Given a consumer configured for two jobs at once with a ceiling raised to four
    And a backlog of jobs that each wait on IO
    When every slot stays taken while the event loop is idle
    Then the consumer comes to run four jobs at once
    And it never runs more than four

  @unit
  Scenario: With GLOBAL_QUEUE_CONCURRENCY_CEILING unset the worker keeps its configured concurrency
    Given a worker whose environment sets GLOBAL_QUEUE_CONCURRENCY and no ceiling
    When its queue policy is built
    Then the policy names no ceiling, so slots stay at the configured concurrency

  @unit
  Scenario: GLOBAL_QUEUE_CONCURRENCY_CEILING raises the ceiling slots adapt up to
    Given a worker whose environment sets GLOBAL_QUEUE_CONCURRENCY_CEILING to 1000
    When its queue policy is built
    Then the policy's ceiling is 1000

  @unit
  Scenario: An invalid GLOBAL_QUEUE_CONCURRENCY_CEILING is refused by name
    Given a ceiling that is not a whole number, or is below the configured concurrency
    When the worker's queue policy is built
    Then boot is refused with an error naming GLOBAL_QUEUE_CONCURRENCY_CEILING

  @unit
  Scenario: Slots grow by a quarter while every slot is taken and the event loop is idle
    Given a consumer with every slot taken and an idle event loop
    When it looks at its load
    Then its slots grow by a quarter each time, never past the ceiling

  @unit
  Scenario: A busy event loop gives slots back down to the configured concurrency
    Given a consumer that has grown past its configured concurrency
    When its event loop is near full
    Then its slots shrink by a fifth each time, never below the configured concurrency

  @unit
  Scenario: A nearly full heap gives slots back down to the configured concurrency
    Given a consumer that has grown past its configured concurrency
    When its heap is above four fifths of its limit
    Then its slots shrink by a fifth each time, never below the configured concurrency

  @unit
  Scenario: Slots sitting free keep the count
    Given a consumer with most of its slots free
    When it looks at its load
    Then its slots stay as they are

  @unit
  Scenario: A ceiling at or below the configured concurrency keeps the count fixed
    Given a consumer whose ceiling is its configured concurrency
    When every slot is taken and the event loop is idle
    Then its slots stay at the configured concurrency
