Feature: Suite run progress is derived from its simulation runs
  A suite run is a group of simulation runs sharing a batch. Its progress and
  outcome are computed from those runs when they are read, not accumulated
  into a separate record, so a lost or repeated update cannot change what the
  user sees. (ADR-072; run liveness per ADR-073.)

  # KNOWN GAP — the derivation scenarios below carry no tag, so
  # `check:feature-parity` enforces none of them and the file reports as green
  # while every scenario in it is inert. The behaviour IS implemented and
  # tested; what is missing is the `@scenario` JSDoc binding tying each test
  # back to its scenario here. Tagging them without first writing those
  # bindings would fail parity, so the two go together and are tracked as
  # follow-up. Only the idempotency scenario at the foot of this file is
  # genuinely bound and enforced.
  #
  # See specs/ai-gateway/governance/folds.feature for the same trap found on a
  # compliance surface, and dev/docs/TESTING_PHILOSOPHY.md for the tag
  # contract.

  Background:
    Given a suite with scenarios and targets

  # --- Derivation ---

  Scenario: Batch progress reflects the simulation runs in the batch
    Given a suite run whose scenarios have partly finished
    When the user opens the suite's run history
    Then the passed, failed and running counts match its simulation runs
    And a cancelled run is counted as failed rather than passed

  Scenario: A repeated run update does not inflate progress
    Given a suite run with one finished scenario
    When that scenario's state is recorded more than once
    Then the batch still reports one finished run

  Scenario: A corrected simulation run changes the batch immediately
    Given a batch showing a failed scenario
    When that scenario's run is later recorded as succeeded
    Then the batch reflects the success on the next read
    And no projection has to be rebuilt

  Scenario: Archived runs are left out of the batch
    Given a batch containing an archived scenario run
    When the user opens the suite's run history
    Then the archived run is not counted

  # --- Outcome ---

  Scenario: A batch is unfinished while any scenario is still in flight
    Given a batch with one scenario still running
    When the user opens the suite's run history
    Then the batch is reported as still running

  Scenario: A batch finishes when every scenario has finished
    Given a batch whose scenarios have all reached a terminal state
    When the user opens the suite's run history
    Then the batch reports a completion time

  # --- The denominator ---

  Scenario: The expected total is known from the first run in the batch
    Given a suite run whose scenarios are still being queued
    When the user opens the suite's run history
    Then the expected total is the size of the whole batch
    And it does not grow as the remaining scenarios appear

  Scenario: A partly dispatched batch reports a shortfall
    Given a suite run where one scenario was never queued
    When the user opens the suite's run history
    Then the batch reports fewer runs than were expected

  Scenario: A batch from before the total was recorded counts its runs
    Given a batch recorded without an expected total
    When the user opens the suite's run history
    Then the expected total is the number of simulation runs in the batch

  # --- No second record ---

  Scenario: Starting and finishing a scenario writes no suite-level record
    Given a scenario belonging to a suite
    When it starts and later finishes
    Then no separate suite-run record is written for it
    And the batch's progress is still readable

  # --- Submitting the same run twice ---
  #
  # Retrying a submit is ordinary: a CI job times out and runs again, a browser
  # resends, a script retries a 502. Without a key that costs the customer a
  # duplicate suite run and duplicate spend, and there is no way to tell the
  # duplicate from a deliberate second run.
  #
  # The key is optional on purpose. Omitting it is how "run this again" is
  # expressed, and that stays the default.

  @unit
  Scenario: Resubmitting a suite with the same key does not queue it twice
    Given a suite was submitted for a run with an idempotency key
    When the same suite is submitted again with that same key
    Then the same runs are asked for
    And no second set of runs is queued

  @unit
  Scenario: Submitting without a key runs the suite again
    Given a suite was submitted for a run with no idempotency key
    When the same suite is submitted again with no key
    Then a second set of runs is queued
    And the two runs are reported separately

  @unit
  Scenario: A different key runs the suite again
    Given a suite was submitted for a run with an idempotency key
    When the same suite is submitted with a different key
    Then a second set of runs is queued

  @unit
  Scenario: Two projects reusing one key do not collide
    Given two projects each submit a suite with the same idempotency key
    Then each project queues its own runs
    And neither project's runs are attributed to the other
