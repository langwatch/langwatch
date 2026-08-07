Feature: The unit shard hard floor reports what it never finished
  As a developer whose change is gated on the unit shards
  I want a force-exited shard to name the test files it never got a result for
  So that a file which hangs cannot ship a green check over tests that never ran

  # A vitest finalize wedge can hold a unit shard open long after its last test
  # passes, so a hard floor force-exits the shard to release the CI step. The
  # floor decides the exit code from what the shard reporter recorded while
  # results streamed: any failed test, and any file vitest handed to a worker
  # that never reported back. The event sequence the reporter reads is vitest's
  # own: a file is queued before its worker imports it, and reports its result
  # on completion whether it passed, failed, or was skipped in full.

  Background:
    Given the unit shards run with the shard failure reporter
    And a hard floor force-exits a shard the finalize wedge is holding open

  @unit
  Scenario: A wedge over a clean run still releases the step green
    Given no test failed
    And every test file that started reported a result
    When the hard floor fires
    Then the shard exits zero
    And no file is named

  @unit
  Scenario: A wedge over a failing run stays red
    Given a test failed before the wedge
    And every test file that started reported a result
    When the hard floor fires
    Then the shard exits non-zero
    And the message says failures were reported before the wedge

  @unit
  Scenario: A file that started and never reported turns the shard red
    Given a test file starves the event loop so vitest's own test timeout never fires
    And no test failed
    When the hard floor fires
    Then the shard exits non-zero
    And the message names that file as one that never completed
    And the message says to run that file on its own to see where it hangs

  @unit
  Scenario: The floor says how much of the shard it cut off
    Given the shard still had test files left to start
    When the hard floor fires
    Then the message counts the test files selected, started, and reported
    And it reads the gap as a shard too slow for the floor rather than a hang

  @unit
  Scenario: A skipped file is never mistaken for one that never completed
    Given a test file whose tests are all skipped
    When that file reports its result
    Then it is not named as a file that never completed

  @unit
  Scenario: A run that reached its own end is left to its own accounting
    Given vitest reported the run finished
    When the hard floor fires afterwards
    Then no file is named
    And the shard exits zero
