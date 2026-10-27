Feature: Every account row records who asserted its subject
  Better Auth looks accounts up by provider and subject since 1.7.3 and no
  longer writes `Account.issuer`. Auth's account create hook writes it, with
  the values Better Auth 1.7.0 wrote, so rows keep the issuer identity reads
  and the single sign-on migration evidence compare against.

  @unit
  Scenario: An account written without an issuer gets the namespace its provider's rows carry
    Given Better Auth writes an account with no issuer
    When auth resolves the issuer to store on it
    Then a password account is stored under "local:credential"
    And a Google account under "https://accounts.google.com"
    And a Microsoft account under the tenant issuer its verified ID token names
    And any other provider under "local:oauth:" and its provider id
    And an issuer the row already carries is kept

  @unit @integration
  Scenario: A single sign-on account keeps the issuer the connection verified
    Given somebody signs in through a single sign-on connection
    When the plugin admits their account
    Then the account row is stored under the issuer the plugin verified
    And that issuer is not handed to any other account

  @integration
  Scenario: A password linked to an existing user is stored under the local credential issuer
    Given a user with no password
    When auth links a password to them through Better Auth
    Then the new account row's issuer is "local:credential"
