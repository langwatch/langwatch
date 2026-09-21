Feature: Browser session lifecycle
  @unit
  Scenario: A cached Better Auth session has been revoked
    Given Better Auth verified a browser session
    And its persisted session row no longer exists
    Then Auth returns no browser session

  @unit
  Scenario: A live admin impersonation acts as its target
    Given a persisted session has an unexpired impersonation target
    And the target is active
    Then Auth returns the target as the actor and the admin as impersonator

  @unit
  Scenario: Revoking other browser sessions retains the current device
    Given a user has cached and persisted browser sessions
    When Auth revokes every session except the current one
    Then other cached tokens and persisted sessions are removed
    And the current cached token remains

  # Ending a session had no surface at all: somebody who signed in on a shared
  # machine or lost a laptop had no action available anywhere in the product.

  @unit
  Scenario: A person reads the browsers they are signed in on
    Given a person holds several live browser sessions
    When they read their signed-in browsers
    Then each one names its sign-in method in words and whether a second factor was proved
    And the session they are reading from is marked as theirs
    And no session token appears on the list

  @unit
  Scenario: A person ends one of the browsers they are signed in on
    Given a person holds several live browser sessions
    When they end one that is not the session they are reading from
    Then that session is ended and the others remain
    And ending the session they are reading from reports session_is_current
    And naming a session that is not theirs ends nothing
