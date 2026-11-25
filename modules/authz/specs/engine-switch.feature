Feature: Authz owns the switch that puts an organization on the engine
  As the authz module
  I need my own record of which organizations the engine answers for
  So that the engine migration's bookkeeping can move to the upgrade framework
  without moving which engine answers anyone's permission checks

  Alex, 2026-10-12: "Separate the switch." The switch is authz's AuthzEngineSwitch row.
  While older images and the legacy runner still write ops' state table, the newer of
  the two rows answers, authz's own on a tie (ARCHITECTURE.md §7, the licensing precedent).

  @unit
  Scenario: An organization with no row on either side stays on the legacy path
    Given an organization with no engine switch and no engine-migration state
    When authz asks which engine answers for it
    Then the legacy path answers

  @unit
  Scenario: A finalized organization stays on the engine once its switch is carried over
    Given an organization whose engine migration finalized in ops' state table
    When authz's switch is carried over from that row
    Then the engine answers for it before and after the carry-over
    And the switch time is the time the migration finalized

  @unit
  Scenario: A rollback recorded after the switch returns the organization to the legacy path
    Given an organization whose engine switch is on
    When an operator's rollback is recorded in ops' state table after it
    Then the legacy path answers for it

  @unit
  Scenario: Authz's own newer switch answers over an older state row
    Given an organization whose engine-migration state row is older than its engine switch
    When authz asks which engine answers for it
    Then the engine switch answers

  @unit
  Scenario: The carry-over is a background step that waits for older images to go
    Given authz's upgrade steps are declared
    Then "authz:carry-over-engine-switch" is a background step
    And it waits until no older image serves

  @unit
  Scenario: Finalizing the engine migration turns authz's own switch on
    Given an organization whose engine migration proves the engine gives the same answers
    When the migration finalizes it
    Then authz's engine switch for it is on

  @unit
  Scenario: A rollback pinned while the migration ran keeps the organization off the engine
    Given an organization an operator rolled back while its migration ran
    When the migration would finalize it
    Then the switch stays off and the organization stays held

  @unit
  Scenario: An organization already on the engine finalizes at once
    Given an organization whose engine switch is on
    When the engine migration visits it
    Then it answers finalized without reading or sending anything
    So an organization an older image finalized during a deploy is not migrated twice

  @unit
  Scenario: An operator's rollback turns authz's switch off
    Given an organization whose engine switch is on
    When ops records that an operator rolled back its engine migration
    Then authz pins its engine switch off
    And a rollback of another step leaves the switch alone
