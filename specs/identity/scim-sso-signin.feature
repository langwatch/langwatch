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
    And the refusal is OAuthAccountNotLinked, sso_existing_account_unconfirmed or the domain gate's existing refusal

  @integration
  Scenario: A signed SAML email does not require an OIDC verification claim
    Given the domain gate accepted a signed SAML assertion for a provisioned member
    When the assertion has no OIDC email verification claim
    Then the same connection's active provisioned member may be selected

  @integration
  Scenario: A member disabled before sign-in is refused and nothing is provisioned
    Given the connection provisioned a member whose membership was disabled and committed
    When its verified identity provider signs that member in
    Then identity reads the committed membership and refuses the account link
    And no account is attached and no session is issued
    And a membership that does not exist is refused the same way

  @unit @regression
  Scenario: The native account-link refusal maps to a stable sign-in error
    When the authentication library reports that the account is not linked
    Then the error is treated as OAuthAccountNotLinked
    And it is classified as a stable sign-in error

  @unit @regression
  Scenario: The different-email refusal shows the specific message
    When the authentication library reports "email_does_not_match"
    Then the error is treated as DIFFERENT_EMAIL_NOT_ALLOWED

  @unit @regression
  Scenario: The earlier library's different-email spelling still shows the specific message
    When a sign-in link from the earlier library release reports "email_doesn't_match"
    Then the error is treated as DIFFERENT_EMAIL_NOT_ALLOWED

  @unit @regression
  Scenario: Every link refusal the installed library redirects with has a specific screen code
    Given the callback error codes and sign-in result codes the installed authentication library defines
    Then email_does_not_match is treated as DIFFERENT_EMAIL_NOT_ALLOWED
    And account_already_linked_to_different_user is treated as OAuthAccountNotLinked
    And the refusal for an existing account under another method is treated as OAuthAccountNotLinked
    And the SSO plugin still redirects the raw sign-in refusal to the error screen
    And every other code read is classified as having no specific screen

  @unit @regression
  Scenario: An upgrade that adds or renames a library code fails until the code is classified
    Given a code the installed library redirects with that no classification names
    Then the pinning test fails and names the code

  @unit @regression
  Scenario: Every code the library sends keeps the screen code it had before
    Given the screen code each live library code produced before the spellings were pruned
    When each code is read again
    Then it produces the same screen code and the same stable classification

  @unit @regression
  Scenario: A sign-in that succeeds is not read as a failure
    Given a person who is signed in, or whose provider account is already linked, signs in
    When the callback redirects without an error code
    Then no error code is read and the redirect passes through unchanged

  @unit @regression
  Scenario: The SSO plugin's spaced account-link spelling still shows the account-link message
    When the SSO plugin's OIDC callback reports "account not linked"
    Then the error is treated as OAuthAccountNotLinked

  @unit @regression
  Scenario: A bookmarked error address with a retired spelling shows the generic error
    When an error address carries "LINKING_DIFFERENT_EMAILS_NOT_ALLOWED"
    Then the code is not one of ours to hand to somebody
    And the screen shows the generic sign-in error

  @unit @regression
  Scenario: The organization's sign-in cutover codes are unchanged
    When any cutover sign-in error code is read
    Then it is returned as itself and is classified as a stable sign-in error
