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

  # D-A1U-2: the register door moved from user to auth with its wire.
  @unit
  Scenario: The register procedure answers on auth's namespace
    When a signed-out person submits the sign-up form to auth.register
    Then auth checks the request and has user mint the account
    And the answer is the new account's id, as user.register answered before

  # Round 48 (A1-d): auth asks user to adopt, then ends the sessions itself; user calls no auth.
  @unit
  Scenario: Adopting an account ends every session it held before the proof
    Given an account awaiting confirmation
    When an address proof adopts it
    Then every browser session on that account is ended
    And a refused adoption ends none

  # Main's local sign-up decision, asked on every registration before the address proof is spent.
  @unit
  Scenario: Registering an address that already has an account keeps its address proof
    Given an address that already has an account
    When the sign-up form is submitted for it with a password
    Then the registration is refused as "auth_direct_registration_unavailable"
    And the address proof is not spent and no account is written

  @unit
  Scenario: Registering an address an organization signs in through its own connection is refused in every sign-in mode
    Given an address whose domain an organization routes to its own connection
    When the sign-up form is submitted for it with a password, in email mode or beside a provider
    Then the registration is refused as "auth_direct_registration_unavailable"
    And the address proof is not spent and no account is written

  @unit
  Scenario: Registering an address the sign-in routing offers no password is refused
    Given the sign-in routing offers this address no password
    When the sign-up form is submitted for it with a password
    Then the registration is refused as "auth_direct_registration_unavailable"
    And the address proof is not spent and no account is written

  @unit
  Scenario: A caller over the sign-up budget is told how long to wait
    Given a caller that has registered too often this hour
    When it submits the sign-up form again
    Then the refusal is "auth_rate_limited" and names the seconds to wait
    And the address proof is not spent
