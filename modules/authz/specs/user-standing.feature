Feature: Authz keeps who is deactivated or erased from its peers' facts

  Authz learns who is deactivated or erased from user's and identity's facts, into a table it
  owns, and never reads the User table. A deactivated or erased user's platform grant confers
  nothing and their SSO admission is not completed. See dev/docs/ARCHITECTURE.md, "Platform
  operators are a grant".

  @unit
  Scenario: A deactivated user is inactive to authz until reactivated
    Given user records an account as deactivated
    When authz hears the fact
    Then authz holds the user as inactive
    And once user records the account reactivated, authz holds them active again

  @unit
  Scenario: A redelivered user fact changes nothing
    Given authz has applied a user's deactivation and a later reactivation
    When the deactivation is delivered again
    Then the user stays active
    And erasing a user who holds no platform grant revokes nothing

  @unit
  Scenario: An erased user stays inactive
    Given identity records a user as erased
    When user later records the account reactivated
    Then authz still holds the user as inactive

  @unit
  Scenario: Erasure revokes the erased person's platform grant
    Given a user holds the platform-operator grant, even as its last holder
    When identity records the user as erased
    Then authz marks the user gone first
    And revokes their grant as the system with reason "user-erased"
    And the same revoke is refused while the standing table still holds the user as active

  @unit
  Scenario: A deactivation and a reactivation stamped at the same instant leave the user inactive
    Given user's deactivation and reactivation facts carry the same instant, from pods whose clocks differ
    When authz hears both, in either order
    Then authz holds the user as inactive
    And a tie goes to the deactivation, since only each pod's clock orders the two
