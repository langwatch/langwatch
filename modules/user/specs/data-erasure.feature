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

  # Dashboards split (2026-10-15): DashboardsV2, DashboardWidget and DashboardFavourite hold a
  # person's boards, widgets and stars apart from the Analytics Reports tables.
  @integration
  Scenario: Erasing a user removes their Only me boards and their stars, and keeps shared boards
    Given a user with an Only me board holding a widget, a Project board another member starred,
      and stars of their own
    When their erasure runs
    Then the Only me board, its widgets and every star on it are gone, and so are the user's stars
    And the Project board and its widgets stay with no author, with the other member's star
    And the boards, widgets and stars of a project only the user owned go with that project

  @integration
  Scenario: Erasing a user removes the Reports copy of their Only me boards
    Given a user's Only me board with only widgets, and one that also holds a chart made in
      Analytics Reports, each with the Reports row and srcdoc copies the split left behind
    When their erasure runs
    Then no srcdoc copy of either board is left, and Reports no longer holds the first board
    And the second board's Reports row keeps its chart at Only me with no author, so nobody sees it

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
