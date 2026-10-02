@auth
Feature: Sign-up
  What a new account receives when it is created, and what it does not.

  @integration
  Scenario: Sign-up creates the account and confirms the address afterwards
    Given a sign-up whose confirmation link was reopened and opened no session
    When the confirmation screen shows
    Then it offers the way in

  @unit
  Scenario: Signing up with a passkey creates the account and the session together
    When an account is created by signing up with a passkey
    Then the session is written by the same transaction that writes the credential

  @unit
  Scenario: New user with matching SSO domain joins the SSO org
    Given an organization whose SSO domain matches the new user's verified address
    When the user is created
    Then the user joins that organization as a member

  @unit
  Scenario: Unverified signup with a matching ssoDomain does not auto-join the SSO org
    Given an organization whose SSO domain matches an unverified sign-up's address
    When the user is created
    Then no membership and no grant are created at that organization

  @unit
  Scenario: Unverified signup does not claim a pending invite addressed to its email
    Given a pending invite addressed to an unverified sign-up's address
    When the user is created
    Then the invite stays unapplied and nothing is granted
