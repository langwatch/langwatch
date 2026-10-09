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

  @unit
  Scenario: An organization's signed-in count holds its own members only
    Given members of an organization and people outside it hold live browser sessions
    And one member holds several sessions and another's has expired
    When the signed-in users are counted for that organization's members
    Then each member with a live session counts once
    And nobody outside the organization is counted

  @unit
  Scenario: A run nobody started acts as the system actor at the door
    Given an ownerless key minted for a run nobody started, such as a monitor's
    When the run calls a project route with it
    Then the handler's actor is the system acting for an unattended run
    And never the creator of the monitor, nor nobody

  @unit
  Scenario: The browser session procedures answer on auth's namespace
    Given a signed-in person reading from one of their browsers
    When they list their browsers or end one over auth's procedures
    Then auth answers for the caller's own account, with the reading browser named as current

  # Organization records a seat taken away; auth, which owns the sessions, ends them from its own
  # side, eventually, while authorization refuses them at once (ruling R7, D-A1U-6).
  @unit
  Scenario: A member disabled in an organization loses their browser sessions
    Given organization has recorded a member as disabled
    When auth receives that fact
    Then every browser session that person holds is ended

  @unit
  Scenario: A redelivered seat revocation is keyed alike and harmless
    Given organization's member-disabled fact was already handled
    When the same fact is delivered again
    Then both deliveries share one deduplication key
    And ending the sessions again leaves the account with none

  @unit
  Scenario: Seat revocations the previous release queued on user's lane run on auth's
    Given a seat revocation the previous release queued on user's member-disabled lane
    When a worker of this release drains the queue
    Then auth's member-disabled lane consumes it until the alias window closes
