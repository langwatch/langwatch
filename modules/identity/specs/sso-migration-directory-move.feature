Feature: A finished SSO migration moves its directory sync through scim

  When an organization's move to its own identity provider finishes, identity's
  connection pipeline reacts on the worker and asks scim, through its Api, to
  move the replaced connection's directory sync. Scim records that as a command
  on its own pipeline and its worker does the move (ARCHITECTURE.md §9).

  @unit
  Scenario: A finished migration asks scim to move the replaced connection's directory
    Given a connection that replaced the organization's previous one
    When its migration finishes
    Then identity asks scim to move the previous connection's directory onto it

  @unit
  Scenario: A finished connection that replaced none asks scim for nothing
    Given a connection that replaced no other
    When its migration finishes
    Then identity asks scim for nothing
