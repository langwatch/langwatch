Feature: Browser session lifecycle
  Scenario: A cached Better Auth session has been revoked
    Given Better Auth verified a browser session
    And its persisted session row no longer exists
    Then Auth returns no browser session

  Scenario: A live admin impersonation acts as its target
    Given a persisted session has an unexpired impersonation target
    And the target is active
    Then Auth returns the target as the actor and the admin as impersonator

  Scenario: Revoking other browser sessions retains the current device
    Given a user has cached and persisted browser sessions
    When Auth revokes every session except the current one
    Then other cached tokens and persisted sessions are removed
    And the current cached token remains
