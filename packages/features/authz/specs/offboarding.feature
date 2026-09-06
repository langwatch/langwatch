Feature: Offboarding removes access completely

  Removing a user from an organization must remove every grant they held
  there, must not touch their grants elsewhere, and must tell the caller
  when a partial removal leaves something behind.

  # authz-offboarding.service.ts, authz-grant-guards.service.ts,
  # authz-grant-snapshot.service.ts, authz-scope-lineage.service.ts,
  # authz-binding-reader.service.ts, role-binding-read-back.rules.ts

  @unit @unimplemented
  Scenario: Offboarding removes every grant the user held in the organization
    Given a user holding grants at organization, team and project scope
    When they are offboarded from that organization
    Then none of those grants remain

  @unit @unimplemented
  Scenario: Offboarding leaves the user's grants in other organizations alone
    Given a user who is a member of two organizations
    When they are offboarded from one
    Then their grants in the other are unchanged

  @unit @unimplemented
  Scenario: An offboarding that cannot remove every grant reports incompleteness
    Given a user whose grant removal partially fails
    When they are offboarded
    Then the caller is told the offboarding is incomplete, naming what remains

  @unit @unimplemented
  Scenario: A grant written at a scope is readable back at that scope immediately
    Given a role binding just written at project scope
    When the binding is read back
    Then it is present at that scope and at no ancestor scope
