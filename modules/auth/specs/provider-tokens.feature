Feature: Sign-in keeps no provider token
  As an operator holding sign-in accounts
  I want no OAuth or OIDC token stored once a sign-in is verified
  So that the account table keeps no credential that can reach a provider

  Sign-in asks providers for profile and email only, never calls them back on
  a person's behalf and never signs out at the provider, so the access,
  refresh and ID tokens a callback returns are spent once it is verified. The
  account hooks read the ID token's claims first (session evidence, link
  evidence), then write nulls in place of every token. Rows written before
  this rule are cleared by a background step.

  @unit
  Scenario: A new sign-in account is written without its provider tokens
    Given a provider callback hands Better Auth an account with access, refresh and ID tokens
    When the account create hook runs
    Then the row it writes carries no access, refresh or ID token

  @unit
  Scenario: A returning sign-in clears the tokens its account still holds
    Given a returning sign-in refreshes an account's access, refresh and ID tokens
    When the account update hook runs
    Then the update writes no token and nulls the ones the row still holds

  @unit
  Scenario: An account update that carries no token keeps every field it writes
    Given an account update that writes a new password and no token
    When the account update hook runs
    Then the update still writes the password
    And it writes no token

  @unit
  Scenario: The token discard step is a background step that waits for old writers to go
    Given auth's upgrade steps are declared
    Then "auth:discard-provider-tokens" is a background step
    And it waits until no older image serves

  @unit
  Scenario: The token discard step clears every account's tokens once
    Given two accounts holding provider tokens and one holding none
    When the token discard runs as a dry run
    Then it reports two accounts it would clear and clears nothing
    When the token discard runs
    Then it reports two accounts cleared and no account holds a token
    And a second run reports none cleared

  @integration
  Scenario: The token discard SQL leaves each account's other columns and update time alone
    Given an account row holding provider tokens, a scope and an update time
    When the token discard runs against Postgres
    Then its access, refresh and ID tokens are null
    And its scope and update time are unchanged
