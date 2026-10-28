Feature: An account row keeps the issuer namespace of whoever asserted its subject
  Since better-auth 1.7.3 an account row is found by its provider and subject alone, and
  better-auth writes no issuer. A subject is unique only within an issuer, so LangWatch
  stamps `Account.issuer` itself and refuses a single sign-on subject stored under another
  issuer. Existing rows keep the issuer they carry. ADR: dev/docs/adr/189-account-issuer-is-langwatchs-namespace.md

  @unit
  Scenario Outline: A new account row carries the issuer namespace its provider's stored rows carry
    Given somebody signs in for the first time through "<provider>"
    When its account row is written
    Then the row carries "<issuer>" as its issuer
    And not the issuer the provider's discovery document names

    Examples:
      | provider   | issuer                      |
      | credential | local:credential            |
      | google     | https://accounts.google.com |
      | github     | local:oauth:github          |
      | auth0      | local:oauth:auth0           |
      | okta       | local:oauth:okta            |

  @unit
  Scenario: A Microsoft account row carries its tenant's issuer
    Given somebody signs in for the first time through "microsoft"
    And the ID token states their tenant's issuer
    When its account row is written
    Then the row carries the tenant's issuer
    And a row whose ID token states no issuer carries "local:oauth:microsoft"

  @unit
  Scenario: A single sign-on account row carries the issuer its assertion was verified under
    Given a single sign-on connection verified the assertion for a subject
    When that subject's account row is written
    Then the row carries the issuer the assertion was verified under

  @unit
  Scenario: The issuer one subject was verified under is never stamped on another
    Given a single sign-on connection verified the assertion for one subject
    When an account row is written for another subject or another connection
    Then that row does not carry the first assertion's issuer

  @unit
  Scenario: A connection subject stored under another issuer is refused
    Given a connection's account row for a subject was stored under one issuer, under no
      issuer, or under a `local:` namespace
    When another issuer asserts the same subject through that connection
    Then the sign-in is refused as not linked
    And nobody is signed in as the row's person
    And no link proposal is recorded

  @unit
  Scenario: A connection subject stored under its own issuer still signs in
    Given a connection's account row for a subject stores the asserted issuer, with or
      without a trailing slash
    When the connection's issuer asserts that subject
    Then the sign-in is not refused for its issuer
