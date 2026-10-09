Feature: Sign-in serves while the installation upgrades
  Once the schema steps are done the api serves in upgrading mode: sign-in only,
  so a platform operator can sign in and follow the upgrade on Ops > Upgrades.
  Ruling: Alex, 2026-10-09 (UIW-6; plan dev/docs/plans/upgrade-in-worker-2026-10-09.md section 4).

  @unit
  Scenario: The Better Auth handler, the session poll, logout and the sign-in reads serve while upgrading
    Given the api is in upgrading mode
    When a browser reads its session or its prior session, calls Better Auth, signs out or asks where an address signs in
    Then each request passes the holding door to the sign-in door's own answer
    And a sign-up procedure and the legacy project-token check answer 503 before the door, though the token check sits beneath the Better Auth wildcard
