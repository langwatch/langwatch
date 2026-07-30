@unit
Feature: Applying a delivery to a fold is one governed read-decide-write cycle
  Every fold shares the same cycle for turning a delivery into stored state:
  read what is there, decide whether this delivery has already been applied,
  and write the result. That cycle has exactly one dangerous decision inside
  it — what a fold does when it cannot read the row it found. A read that
  cannot be decoded must never be treated as an aggregate that has never been
  seen before, because the two look identical from the outside and only one of
  them is safe to overwrite. Collapsing them turns a shape change into a
  silent, population-wide reset: every existing aggregate starts over from a
  fresh accumulator, stamped as current, with no trace of what it replaced.

  The same cycle also carries the tenancy and retention a delivery belongs to
  through to the store, and recognises a delivery that has already been
  applied by its sequence rather than by guessing from its contents, so a
  retried delivery is a safe no-op regardless of what it carries. (ADR-098.)

  Background:
    Given a fold declared with a genesis state and a rule for applying an event to it

  Scenario: the first delivery for a key starts from the fold's genesis state
    Given no state has ever been stored for this aggregate
    When a delivery arrives for that aggregate
    Then the fold starts from its genesis state
    And every event in the delivery is applied on top of it
    And the resulting state is written to the store

  Scenario: a later delivery folds onto the existing state, not a fresh one
    Given an aggregate that already has a stored state
    When a further delivery arrives for that aggregate
    Then the new events are applied on top of the stored state
    And what the stored state already held is carried forward into the result

  Scenario: a redelivered job is recognised by sequence, not skipped by content
    Given an aggregate whose stored state already reflects a particular delivery's sequence
    When a delivery carrying that same sequence, or an earlier one, arrives again with different events inside it
    Then it is skipped as a redelivery
    And nothing is written to the store
    And the events it carries play no part in that decision

  Scenario: a shape change never overwrites unreadable state with a fresh accumulator
    Given a stored row for this aggregate that the current build cannot read
    When a delivery arrives for that aggregate
    Then the fold refuses to treat the unreadable row as if no state existed
    And it fails loudly rather than starting over from a fresh accumulator
    And nothing is written to the store
    And the failure names the projection, the aggregate, and the shape that could not be read

  Scenario: a failed write is never swallowed into a false "applied" outcome
    Given a store whose write fails
    When a delivery is applied
    Then the failure propagates to the caller
    And no applied outcome is reported

  Scenario: the store sees the tenant and retention the delivery carried
    Given a delivery that names a tenant and a retention period
    When the fold reads and then writes state for that delivery
    Then both the read and the write are made in that tenant and retention
    And that context comes from the delivery itself, not from anything reconstructed later

  Scenario: an applied delivery is distinguishable from a skipped one on the dashboard
    Given a fold that reports its outcomes to a dashboard
    When one delivery is applied and another is skipped as a redelivery
    Then the applied delivery is counted on its own and the size of its batch is recorded
    And the skipped delivery is counted separately, with no batch size recorded for it

  Scenario: every failure lands on the same counter as a success, so the denominator is every attempt
    Given a fold whose store cannot be reached
    When a delivery is applied
    Then the failure is counted on the same measure that counts successes
    And a projection failing every delivery does not read as one that is merely quiet

  Scenario: a fold that throws in its own apply is not the one failure nothing counts
    Given a fold whose own logic raises on an event it was not built for
    When a delivery is applied
    Then that failure is counted alongside store failures
