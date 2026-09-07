Feature: Collaborative presence
  Presence state and cursor fanout are owned by one process-composed service.

  @unit
  Scenario: A first heartbeat joins a project
    Given presence is enabled for the project
    And the browser session is not currently present
    When the session sends a heartbeat
    Then the service stores the session with a bounded TTL
    And it publishes one join delta

  @unit
  Scenario: An unchanged heartbeat refreshes only the TTL
    Given the browser session is already present at the same location
    When the session sends another heartbeat
    Then the service refreshes the stored session
    And it publishes no duplicate delta

  @unit
  Scenario: Leaving twice is idempotent
    Given a browser session has already left
    When the leave operation is delivered again
    Then the service reports success
    And it publishes no second leave delta

  # Every project member holds the permission presence takes, so the permission is not what
  # separates one member's published session from another's: ownership is.
  @unit
  Scenario: A member cannot remove another member's presence session
    Given another member of the project is present in a browser session
    When I ask to remove that member's session
    Then the removal is refused as not mine to make
    And that member stays present to everyone watching

  @unit
  Scenario: Presence uses Project-owned policy
    When Presence decides whether a project is enabled
    Then it asks the canonical Project service
    And it does not query Project or Organization persistence

  @unit
  Scenario: Existing transports remain compatible
    Given a client calls the existing presence tRPC procedures
    When the compatibility router handles the request
    Then it delegates to the process-owned Presence service
    And existing procedure names and payloads remain unchanged
