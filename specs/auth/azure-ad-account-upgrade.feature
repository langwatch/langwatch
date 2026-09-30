Feature: Azure AD accounts keep signing in after the better-auth 1.7 upgrade

  Before 3.17 a Microsoft account was stored under the id token's `sub`, with
  the synthetic issuer `local:oauth:microsoft` added by the account issuer
  migration. better-auth 1.7 looks the account up by the token's `iss` and
  `oid` instead. Neither value can be derived from the stored row, but the
  id token of the next sign-in carries all three, so that sign-in moves the
  stored row onto the new key before better-auth looks it up. No operator
  step is needed, whatever tenant the deployment is configured with.

  @unit
  Scenario: A Microsoft id token names the key move from sub to iss and oid
    Given a Microsoft id token with a sub, an oid and a tenant issuer
    When the key move is derived from it
    Then it moves the account stored under the sub onto the issuer and the oid
    And a token missing any of the three claims asks for no move

  @integration
  Scenario: The first sign-in after the upgrade moves the pre-3.17 account onto the new key
    Given a user whose Microsoft account is stored under its sub and the synthetic issuer
    And an identifier seeded from that account
    When the user signs in with Microsoft
    Then the account and the identifier carry the token's issuer and oid
    And the user's credential account and other provider accounts are untouched

  @integration
  Scenario: Signing in again after the move changes nothing
    Given a Microsoft account already moved onto the token's issuer and oid
    When the user signs in with Microsoft again
    Then no account is changed

  @integration
  Scenario: An account already on the new key is never overwritten by a legacy row
    Given a Microsoft account on the token's issuer and oid
    And a second Microsoft account still stored under the token's sub
    When the user signs in with Microsoft
    Then both accounts are left as they are

  @integration
  Scenario: A pre-3.17 Azure AD user signs in through the Microsoft callback onto their existing account
    Given a user whose Microsoft account is stored under its sub and the synthetic issuer
    And the identifier the upgrade adopted from that account
    When the user completes a Microsoft sign-in
    Then the account is moved onto the token's issuer and oid before it is looked up
    And the sign-in lands on the existing user with no second user or account

  @unit @integration
  Scenario: A sign-in whose account move fails is stopped instead of reaching account linking
    Given a user whose Microsoft account is stored under its sub and the synthetic issuer
    When the user signs in with Microsoft and the account cannot be moved
    Then the sign-in fails without a session
    And no second user or account is created and the account keeps its old key
    And signing in again moves the account and signs the user in
