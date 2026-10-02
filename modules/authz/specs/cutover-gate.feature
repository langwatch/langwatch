@unit
Feature: The cached cutover gate
  As the AuthZ module
  I need one cached answer to "has this organization's AuthZ migration finalized"
  So that compatibility writes, legacy API-key adoption and share-link routing
  follow the migration's status without a deploy or a restart

  Permission checks and access listings do not ask the gate: they read the
  grants head directly (specs/rbac/unified-authorization-engine.feature).
  Rollback itself is specs/migration/system-migrations-runner.feature.

  Scenario: Only a finalized migration counts as cut over
    Given an organization whose AuthZ migration status is "finalized"
    When the gate is asked whether it has cut over
    Then the answer is yes
    And a pending, migrated, parked or rolled-back status answers no
    And an organization with no migration status answers no

  Scenario: Rolling back returns an organization to the legacy path within the gate's cache window
    Given the gate has answered that an organization has cut over
    When the organization's migration is rolled back
    Then the gate answers that it has not cut over once its cache window has passed
    And nothing is deployed or restarted for that to hold

  Scenario: A failed migration-state read is reported
    Given the gate cannot read an organization's migration status
    When it is asked whether the organization has cut over
    Then it answers no, keeping the organization on the legacy path for the cache window
    And the failure is reported with the organization and that window
