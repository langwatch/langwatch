Feature: Bindings are never unique

  A principal may be bound to the same role at the same scope more than once,
  within the limits. Nothing refuses an identical binding; a caller that
  re-asserts access it already holds asks to skip instead.

  @unit
  Scenario: An identical binding is attached as a second grant
    Given a user already holds Member on a team
    When the ledger attaches the same binding again
    Then a second grant is written without reading the existing ones

  @unit
  Scenario: A re-assertion that asks to skip leaves an identical binding out
    Given a user already holds Member on a team
    When the ledger attaches the same binding asking to skip what is held
    Then nothing is written and the existing grant is answered as the duplicate

  @unit
  Scenario: Changing a binding to a role a sibling already holds is written
    Given a user holds Member and Admin on the same team as two bindings
    When an administrator changes the Member binding to Admin
    Then the role change is sent rather than refused as a duplicate

  @unit
  Scenario: A group bound twice to the same role and scope holds both bindings
    Given a group already holds Member on a team
    When an administrator binds the group to Member on that team again
    Then the binding is written rather than refused

  @unit
  Scenario: A role deletion drops the compatibility bindings that still name it
    Given a compatibility role binding still names a custom role
    When the fold projects the role's deletion
    Then the compatibility bindings naming it are removed before the role row
    And the fold does not fail on the custom-role check
