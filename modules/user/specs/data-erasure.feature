Feature: Erasing a user removes their personal data everywhere

  A user's erasure must clear every store holding their personal data,
  resume cleanly if interrupted, and never touch another tenant's records.

  # user-data-erase.task.ts, identity/intents/erase-user.intent.ts

  @integration @unimplemented
  Scenario: Erasing a user removes their personal data from every store that holds it
    Given a user with sessions, memberships and authored records
    When their erasure is requested
    Then no store returns their personal data afterwards

  @integration @unimplemented
  Scenario: An erasure interrupted part-way completes on retry
    Given an erasure that failed after clearing one store
    When it runs again
    Then the remaining stores are cleared and the already-cleared one is not an error

  @unit @unimplemented
  Scenario: Erasure leaves records another tenant owns untouched
    Given two organizations sharing no data
    When a user of one is erased
    Then the other organization's records are unchanged

  @unit
  Scenario: Erasing a user with no blockers runs the erase transaction for the resolved user
    Given a user with no erasure blockers
    When erasure runs with execute set
    Then the erase transaction runs for that resolved user

  # Round 35 (Alex, 2026-10-08): the erased fact commits with the erase, through user's fact outbox.
  @unit
  Scenario: An erasure records user's erased fact with the erase
    Given a user with no erasure blockers
    When erasure runs with execute set
    Then one "lw.user.erased" intent is committed to user's fact outbox in the erase transaction, after the user row goes
    And it is keyed by the user alone, so a redelivery records nothing new

  @unit
  Scenario: An erasure that rolls back records no erased fact
    Given the erase transaction fails part-way, or its fact cannot be written
    When erasure runs with execute set
    Then the transaction rolls back and no erased fact is committed

  @unit
  Scenario: A dry-run erasure records no fact
    When erasure runs without execute
    Then no erased fact is recorded
