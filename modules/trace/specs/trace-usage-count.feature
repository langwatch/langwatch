Feature: Monthly trace counts per project
  Entitlement meters trace-priced organizations by the distinct traces each project
  captured this UTC billing month, as main's trace usage service did.

  @unit
  Scenario: Each project's distinct traces this billing month are counted
    Given an organization whose two projects captured traces this month and last month
    When its trace counts by project are asked for
    Then each project reports only this month's distinct traces

  @unit
  Scenario: A project outside the organization is refused
    Given a project that belongs to another organization
    When its trace count is asked for under this organization
    Then the count is refused and no trace count is read
