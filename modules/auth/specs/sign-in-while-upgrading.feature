Feature: Sign-in serves while the installation upgrades
  Once the schema steps are done the api serves in upgrading mode: every route that does not
  hold, sign-in and sign-up included, so a platform operator can sign in and follow the upgrade.
  Ruling: Alex, 2026-10-09 (UIW-6, then API-UP-DURING-UPGRADE: every route serves by default).

  @unit
  Scenario: The Better Auth handler, the session poll, logout, sign-up and the sign-in reads serve while upgrading
    Given the api is in upgrading mode
    When a browser reads its session or its prior session, calls Better Auth, signs out or asks where an address signs in
    Then each request passes the holding door to the sign-in door's own answer
    And a sign-up procedure and the legacy project-token check pass too, since no auth route holds
