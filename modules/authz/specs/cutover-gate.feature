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

  @unit
  Scenario: An organization that has not finalized reads from legacy
    Given an organization whose migration has not finalized
    When the gate is asked which path to read
    Then it answers from the legacy path

  @unit
  Scenario: Dormant facts never appear as bindings in a listing
    Given grant facts the legacy listing vocabulary cannot carry, dormant facts, or a custom grant whose role names no custom role
    When a cut-over organization's bindings are listed
    Then those facts are left out rather than given a default
    And the query itself excludes resource, platform and dormant rows

  @unit
  Scenario: A listing row keeps its identity across the cutover
    When a cut-over organization's binding is listed
    Then it is listed under the binding's own id, in the legacy vocabulary

  @unit
  Scenario: A cut-over organization's role editor lists roles from the ledger's head
    When a cut-over organization's custom roles are listed
    Then the rows come from the role head, in the custom role shape, business time first
