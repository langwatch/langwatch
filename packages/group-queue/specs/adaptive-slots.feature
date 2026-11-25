Feature: A consumer's slots follow the throughput the system absorbs
  As the queue every fold and command runs through
  I want the number of jobs a consumer runs at once to grow only while that gets more work done
  So that a big install uses its headroom and a small one stops before it overloads its stores

  The configured concurrency (GLOBAL_QUEUE_CONCURRENCY, 100 by default) is the floor: a consumer
  starts there and never runs fewer. Once a second it measures the jobs that finished: completed
  jobs per second, their median duration and the share that failed, waiting for 50 finished jobs
  or ten seconds, and how many slots were taken as each finished. With nine in ten slots taken
  on average and the event loop under 85% busy it grows by a quarter,
  discards the measurement that straddles the change, and keeps the step only if completed jobs
  per second rose by 5% or more. A step that adds less is undone, and the count holds for 30
  measurements before it probes again. It shrinks by a fifth when the event loop is over 95%
  busy, the heap over 80% of its limit, the median duration doubles against its recent baseline
  without throughput rising, or failures reach a tenth of finished jobs and twice their baseline.
  It never runs more than 1000 jobs at once. No setting changes this (Alex, 2026-10-20).

  @integration
  Scenario: Slots settle near what a saturated store absorbs instead of climbing
    Given a consumer configured for two jobs at once
    And a backlog of jobs that share a store which serves only four at a time
    When the consumer runs the backlog for several measurements
    Then it grows past the two jobs at once it was configured for
    And it never runs more than four times the four the store serves

  @unit
  Scenario: Slots grow by a quarter while each step raises completed jobs per second
    Given a consumer with every slot taken and an idle event loop
    When each growth step raises completed jobs per second by more than 5%
    Then its slots grow by a quarter after each judged step

  @unit
  Scenario: A growth step that adds no throughput is undone and the count holds
    Given a consumer that has just grown by a quarter
    When completed jobs per second rose by less than 5%
    Then its slots step back to the count before the step
    And they hold for 30 measurements before growing again

  @unit
  Scenario: Job duration doubling without more throughput gives slots back
    Given a consumer that has grown past its configured concurrency
    When the median job duration doubles against its recent baseline and throughput does not rise
    Then its slots shrink by a fifth

  @unit
  Scenario: Rising job failures give slots back
    Given a consumer that has grown past its configured concurrency
    When a tenth of its finished jobs fail, twice the share before
    Then its slots shrink by a fifth

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
  Scenario: An event loop without room keeps the count
    Given a consumer with every slot taken whose event loop is over 85% busy
    When completed jobs per second keep rising
    Then its slots stay as they are

  @unit
  Scenario: Slots sitting free keep the count
    Given a consumer with most of its slots free
    When it measures its work
    Then its slots stay as they are

  @unit
  Scenario: Slots never grow past 1000
    Given a consumer configured near 1000 jobs at once
    When every growth step raises throughput
    Then its slots stop at 1000

  @unit
  Scenario: Throughput is measured from the jobs that finished
    Given a consumer whose jobs report their duration and failures
    When fewer than 50 have finished within ten seconds
    Then it takes no measurement yet
    And once enough have finished it measures completed jobs per second, their median duration, the failed share and the slots taken
