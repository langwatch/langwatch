Feature: Sign-in credentials keep no provider token
  As an operator holding sign-in credentials
  I want the OAuth tokens already stored on credentials cleared
  So that a leaked credential table holds nothing that reaches a provider

  Auth stops writing provider tokens and clears them from `Account`
  (modules/auth/specs/provider-tokens.feature). The secret heal copies an
  `Account` row over its credential when the row is newer, so this step runs
  after auth's and leaves `updatedAt` alone: it neither races a token back
  nor wakes the heal.

  @unit
  Scenario: The credential token discard is a background step after auth's
    Given identity's upgrade steps are declared
    Then "identity:discard-provider-tokens" is a background step
    And it waits until no older image serves
    And it runs after "auth:discard-provider-tokens"

  @integration
  Scenario: The credential token discard clears tokens and leaves passwords and update times alone
    Given a credential holding provider tokens and one holding only a password
    When the credential token discard runs against Postgres
    Then the first credential's access, refresh and ID tokens are null
    And both credentials keep their password, scope and update time
    And a second run reports none cleared
