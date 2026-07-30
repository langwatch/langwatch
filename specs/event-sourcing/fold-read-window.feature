@unit
Feature: Fold read windows are declared, not hand-rolled
  A fold whose backing table is time-partitioned wants its read-back pruned to
  a window of partitions around the event being folded. The window's width and
  its miss handling are platform concerns declared once on the fold definition
  — not a hint every store forwards by hand and every repository widens with
  its own arithmetic and its own (sometimes forgotten) fallback. A forgotten
  fallback is how a live aggregate reads back as null and a partial batch
  permanently overwrites the complete row. (ADR-066; companion to
  fold-read-back-store.feature.)

  Background:
    Given a fold projection whose state is persisted in a time-partitioned table

  Scenario: a declared read window bounds the store read
    Given the fold declares a read window
    When an event is folded
    Then the store read is bounded to the declared window around the event's business time
    And the store applies the window it was given without choosing a width of its own

  Scenario: a windowed miss retries unwindowed before treating the aggregate as new
    Given the fold declares a read window
    And an aggregate whose committed row sits outside that window
    When its next event is folded
    Then the platform retries the read once without the window
    And the retry does not consult the read cache again
    And the recovered state is folded onto, not replaced
    And the recovery is counted so a drifting window is visible

  Scenario: a row the store found but refused is not read again unwindowed
    Given the fold declares a read window
    And a committed row the store finds but refuses because it was written under an older shape
    When its next event is folded
    Then the platform does not retry the read without the window
    And the refusal is not reported as a window that needs widening

  Scenario: a genuinely new aggregate still starts empty
    Given the fold declares a read window
    And an aggregate that has never been folded
    When its first event arrives
    Then the windowed read and the unwindowed retry both find nothing
    And the fold starts from an empty state

  Scenario: a fold without a declared window reads unbounded
    Given the fold declares no read window
    When an event is folded
    Then the store read carries no window
    And no retry is attempted on a miss

  Scenario: an event without a usable business time reads unbounded
    Given the fold declares a read window
    When an event with no business time is folded
    Then the store read carries no window
