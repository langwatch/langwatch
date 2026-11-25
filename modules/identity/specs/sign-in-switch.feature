Feature: Identity owns the switch that puts a user on the identifier sign-in path
  As the identity module
  I need my own record of which users sign in on the identifier path
  So that the identifier backfill's bookkeeping can move to the upgrade framework
  without moving which sign-in path anyone takes

  Alex, 2026-10-12: "Separate the switch." The switch is identity's IdentitySignInSwitch row.
  While older images and the legacy runner still write ops' state table, the newer of the
  two rows answers, identity's own on a tie (ARCHITECTURE.md §7, the licensing precedent).

  @unit
  Scenario: A user with no row on either side signs in on the legacy path
    Given a user with no sign-in switch and no identifier-backfill state
    When sign-in asks which path the user takes
    Then the legacy path answers

  @integration
  Scenario: A finalized user stays on the identifier path once the switch is carried over
    Given a user whose identifier backfill finalized in ops' state table
    When identity's sign-in switch is carried over
    Then the user's switch is on, at the time the backfill finalized
    And the user signs in on the identifier path before and after the carry-over

  @integration
  Scenario: Sign-up sets identity's sign-in switch
    Given a new user an arrival adopted
    When the arrival records the user as proven
    Then identity's sign-in switch for the user is on
    And ops' state row says finalized at the same time, so an older image agrees

  @integration
  Scenario: A user an operator rolled back stays on the legacy path at sign-up
    Given a user whose identifier backfill an operator rolled back
    When an arrival records the user as proven
    Then the user signs in on the legacy path
    And identity's sign-in switch is not turned on

  @unit
  Scenario: A rollback or a reopen recorded after the switch returns the user to the legacy path
    Given a user whose sign-in switch is on
    When a rollback or a reopen is recorded in ops' state table after it
    Then the user signs in on the legacy path

  @unit
  Scenario: The carry-over is a background step that waits for older images to go
    Given identity's upgrade steps are declared
    Then "identity:carry-over-sign-in-switch" is a background step
    And it waits until no older image serves

  @unit
  Scenario: Proving a user's identifier backfill turns identity's switch on
    Given a user the identifier backfill proves
    When the backfill finalizes them
    Then identity's sign-in switch for them is on

  @unit
  Scenario: A user already on the identifier path finalizes at once
    Given a user whose sign-in switch is on
    When the identifier backfill visits them
    Then it answers finalized without running the backfill
    So a user an older image finalized during a deploy is not migrated twice

  @unit
  Scenario: A user pinned off while the backfill ran stays held
    Given a user an operator rolled back while the backfill ran
    When the backfill would finalize them
    Then the switch stays off and the user stays held
    And the hold waits on a person, an operator lifting the pin, not on a proof

  @unit
  Scenario: An operator's rollback pins identity's sign-in switch off
    Given a user on the identifier path
    When ops records that an operator rolled back their identifier backfill
    Then identity pins the user's sign-in switch off
    And a rollback of another step leaves the switch alone
