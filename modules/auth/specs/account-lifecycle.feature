Feature: Account changes that end credentials

  # Rulings 2026-10-07, A1-user D-A1U-5 revised and D-A1U-6: user owns the account row and its
  # facts; auth owns every credential, so the doors that must end credentials are auth's.

  Rule: Deactivation writes, then ends every credential family, then records the fact

    @unit
    Scenario: Deactivating an account ends every session family after the write
      Given an active account
      When auth deactivates it, by self-service or through the door an operator's back office calls
      Then user writes the account deactivated
      And browser sessions are revoked
      And CLI tokens are revoked
      And only then is user's deactivation fact recorded

    @unit
    Scenario: A refused deactivation revokes nothing
      Given the account is the only active platform operator
      When auth deactivates it
      Then it is refused with code user_last_platform_operator
      And no browser session or CLI token is revoked
      And no deactivation fact is recorded

    @unit
    Scenario: Deactivation ends access even when user's fact cannot be sent
      Given user's lifecycle fact cannot be sent
      When auth deactivates an active account
      Then the request fails
      And browser sessions and CLI tokens were already revoked

    @unit
    Scenario: Deactivating somebody else's account needs the platform-operator grant
      Given a caller who is no platform operator
      When they deactivate somebody else's account
      Then it is refused with code forbidden
      And nothing is written or revoked
      And a platform operator deactivating the same account succeeds, recorded with them as the actor

    @unit
    Scenario: An impersonated caller cannot deactivate another account
      Given a platform operator impersonating a customer
      When they deactivate another account
      Then it is refused with code forbidden
      And nothing is written or revoked

    @unit
    Scenario: The deactivate procedure answers on auth's namespace
      When a signed-in person calls auth.deactivate for their own account
      Then the account is deactivated as themselves
      And the answer is success, as user.deactivate answered before

    @unit
    Scenario: The password procedures answer on auth's namespace
      When a signed-in person calls auth.setPassword, auth.changePassword or auth.unlinkAccount for their own account
      Then auth acts on the account as themselves
      And the answer is success, as user.setPassword, user.changePassword and user.unlinkAccount answered before

  Rule: Credential writes go through Better Auth's account storage, where sign-in reads

    @unit
    Scenario: A changed password is the one sign-in accepts
      Given an account that signs in with password "P"
      When its holder changes the password from "P" to "Q"
      Then signing in with "Q" succeeds
      And signing in with "P" is refused

    @unit
    Scenario: A removed sign-in method no longer signs in
      Given an account holding a password and a linked provider
      When its holder removes the linked provider
      Then the account storage sign-in reads no longer holds it
      And removing the last remaining way in is refused

  Rule: An address change writes through user, then ends the sessions that cached the old one

    @unit
    Scenario: Changing an email refreshes authenticated identity
      When auth changes an account's address to a different one
      Then user stores the normalized address
      And every browser session of the account is revoked

    @unit
    Scenario: Saving the same address signs nobody out
      When auth changes an account's address to the one it already holds, in another case
      Then no browser session is revoked

    @unit
    Scenario: An address change for an unknown account revokes nothing
      When auth changes the address of an account that does not exist
      Then it is refused with code user_not_found
      And no browser session is revoked
