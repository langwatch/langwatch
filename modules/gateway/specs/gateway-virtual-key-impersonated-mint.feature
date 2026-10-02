Feature: No virtual key is minted while an operator acts as another member
  A session whose user carries an impersonator holds no grant to issue credentials as that
  member, so creating or rotating a virtual key over tRPC is refused before any permission read.

  @unit
  Scenario: Creating a virtual key is refused while an operator acts as another member
    Given an operator acting as a member through impersonation
    When they create a virtual key for the member's organization
    Then the create is refused with permission_denied before any permission is asked

  @unit
  Scenario: Rotating a virtual key is refused while an operator acts as another member
    Given an operator acting as a member through impersonation
    When they rotate a virtual key in the member's organization
    Then the rotation is refused with permission_denied before the key is read
