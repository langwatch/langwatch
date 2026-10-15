Feature: An account the identifier backfill has not reached is still read
  As a person whose account predates the identifier backfill
  I want sign-in and better-auth reads to find what my legacy rows hold
  So that a migration still in progress never locks me out

  @unit
  Scenario: An unlatched account's sign-in methods come from its legacy rows
    Given an existing account holds "sam@home.net"
    And that account's identifier backfill is not finalized
    And no identifier holds "sam@home.net"
    And its legacy rows hold a passkey and the "auth0" provider
    When the sign-in methods for "sam@home.net" are looked up
    Then the answer offers the passkey and the "auth0" provider

  @unit
  Scenario: An unlatched account's legacy rows win over its partial identifier heads
    Given an existing account holds "sam@home.net"
    And that account's identifier backfill is not finalized
    And the identifier projection already holds "sam@home.net" for an email head
    And its legacy rows hold a password and the "okta" provider
    When the sign-in methods for "sam@home.net" are looked up
    Then the answer is read from the legacy rows
    And it offers the password and the "okta" provider

  @unit
  Scenario: An issuer-keyed query still finds a row the backfill missed
    Given a user whose "github" account row stores no issuer
    When better-auth reads an account by the synthetic issuer for "github" and its subject
    Then the row is found through its provider id
    And the row is handed back carrying the synthetic issuer, not an empty one
