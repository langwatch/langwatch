Feature: Multiplayer presence within a project
  As a user collaborating with teammates inside a project
  I want to see who else is online and what they are looking at
  So that I can coordinate with them and avoid duplicate work

  # ---------------------------------------------------------------------------
  # Scope
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Presence is scoped to a single project
    Given Alice is online in project A
    And Bob is online in project B
    When Alice subscribes to presence for project A
    Then Alice does not see Bob in the presence list

  @unit
  Scenario: A user with two browser tabs has two independent sessions
    Given Alice is online in project A on tab one viewing trace T1
    And Alice is online in project A on tab two viewing trace T2
    When another user subscribes to presence for project A
    Then they see two presence entries for Alice
    And one entry references trace T1 and the other references trace T2

  # ---------------------------------------------------------------------------
  # Lifecycle
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Joining a project announces the new session to subscribers
    Given Bob is already subscribed to presence for project A
    When Alice opens project A and reports her location
    Then Bob receives a join delta containing Alice's session and location

  @unit
  Scenario: Subscribers receive a snapshot of currently active sessions on connect
    Given Alice and Bob already have active presence in project A
    When Carol subscribes to presence for project A
    Then Carol immediately receives a snapshot containing Alice and Bob

  @unit
  Scenario: A session that stops sending heartbeats expires from presence
    Given Alice has an active presence session in project A with TTL 30 seconds
    When more than 30 seconds pass without a heartbeat
    Then Alice's session is no longer present in the project's session list

  @unit
  Scenario: Leaving the project removes the session immediately
    Given Alice has an active presence session in project A
    When Alice's client sends a leave signal for that session
    Then peers receive a leave delta for Alice's sessionId
    And the session is removed before TTL expiry

  # ---------------------------------------------------------------------------
  # Location updates
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Updating location fans out a single update delta
    Given Alice and Bob both have active presence sessions in project A
    And Alice is currently viewing the traces lens with no trace selected
    When Alice opens trace T1 and selects the flame view
    Then Bob receives an update delta with Alice's new location pointing at trace T1
    And the delta carries the session id, not a fresh join

  @unit
  Scenario: A session that re-reports the same location is a no-op for peers
    Given Alice's location is { lens: traces, traceId: T1, view: { panel: flame } }
    When Alice's client sends the identical location again as a heartbeat
    Then peers do not receive a redundant update delta
    And Alice's TTL is refreshed

  # ---------------------------------------------------------------------------
  # Authorization
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A user without traces:view permission for the project cannot subscribe
    Given Alice has no access to project A
    When Alice attempts to subscribe to presence for project A
    Then the subscription is rejected with an authorization error

  @unit
  Scenario: A user cannot impersonate another user's presence session
    Given Alice and Bob are members of project A
    When Bob sends a presence update payload claiming Alice's userId
    Then the server records the session under Bob's userId, not the claimed one

  # ---------------------------------------------------------------------------
  # Out of scope (explicit guardrails)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Presence does not transmit cursor coordinates or text selection
    Given Alice has an active presence session
    When Alice's client reports her location
    Then the location payload contains only lens, route, and view
    And no cursor, selection, or pointer fields are accepted by the server
