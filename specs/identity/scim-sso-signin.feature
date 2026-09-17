Feature: First sign-in for a provisioned directory member
  A connection may attach its verified assertion to the user it provisioned.
  This does not change the local account's email verification or profile.

  @integration @regression
  Scenario: A provisioned member signs in without creating another account
    Given the connection provisioned an active member with no sign-in account
    And their pending email identifier proves no existing sign-in method
    When its verified identity provider signs that member in
    Then the session belongs to the existing member
    And their local profile and email verification remain unchanged
    And repeating sign-in reuses the same account binding

  @integration @regression
  Scenario: SCIM ownership cannot override conflicting sign-in evidence
    Given a provisioned member whose assertion, ownership, membership or credential evidence is unsuitable
    When the identity provider attempts to sign them in
    Then no account is attached and no session is issued
    And the refusal is OAuthAccountNotLinked or the domain gate's existing refusal

  @integration
  Scenario: A signed SAML email does not require an OIDC verification claim
    Given the domain gate accepted a signed SAML assertion for a provisioned member
    When the assertion has no OIDC email verification claim
    Then the same connection's active provisioned member may be selected

  @integration
  Scenario: Provisioned sign-in evidence stays inside the native transaction
    Given the callback transaction disables a provisioned membership
    When sign-in resolution reads that membership
    Then it sees the uncommitted disable and refuses the account link
    And the transaction context is unavailable after the callback completes

  @unit @regression
  Scenario: The native account-link refusal maps to a stable sign-in error
    When the authentication library reports that the account is not linked
    Then the error is treated as OAuthAccountNotLinked
    And it is classified as a stable sign-in error
