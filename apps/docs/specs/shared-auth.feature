Feature: Use a short-lived session in the docs playground

  @unit
  Scenario: Keep session authentication off by default
    Given no docs session flag is configured
    When the docs composition selects its provider
    Then no session provider is available
    And an unknown flag value is refused

  @unit
  Scenario: Expire and disconnect a mock session
    Given a mock provider grants one project for one minute
    When the credential expires or the reader disconnects
    Then it cannot authorise another request
    And an explicit reconnect obtains a fresh grant

  @unit
  Scenario: Ignore a connection completed after cancellation
    Given a provider has not completed its connection
    When the connection is cancelled
    Then its late result cannot become the active credential

  @unit
  Scenario: Refuse credentials outside the approved scope
    Given a session credential for one project and trace reading
    When a request targets another origin or an unapproved operation
    Then the request is refused without using the network
    And expired or malformed credentials are refused

  @unimplemented
  Scenario: Try the session seam without sending a real credential
    Given the docs were built with the mock session flag
    When the reader opens a trace playground and connects
    Then the demo project and expiry are visible
    And the manual key is cleared and hidden
    When the reader sends a request
    Then a labelled simulated trace response appears without an API call
    And copied examples contain no session credential
    When the session expires
    Then sending is disabled until the reader reconnects
    When the reader disconnects
    Then the manual key option returns empty

  @unimplemented
  Scenario: Approve a real session handoff
    Given the approved app-side mint operation and popup adapter exist
    When the app receives project-scoped consent from a non-impersonated session
    Then the docs accept one schema-valid response from the exact popup and origin
    And incorrect origin, source, state and replayed messages are refused

  @unimplemented
  Scenario: Revoke docs access when the app session ends
    Given a docs credential is bound to a browser session
    When the app revokes that browser session
    Then linked docs credentials are revoked under the existing cache guarantees

  @unimplemented
  Scenario: Connect an explicitly configured self-hosted installation
    Given the operator registered exact app, API and docs origins
    When a reader approves the docs connection
    Then credentials remain scoped to that installation and project
