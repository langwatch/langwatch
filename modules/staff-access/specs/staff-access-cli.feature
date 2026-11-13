Feature: Ops agent access from the CLI
  The agent uses the same `langwatch` CLI customers use. The key lives in a 0600 session file,
  never in `.env`. ADR-202.

  @integration
  Scenario: The CLI requests, waits for approval and stores the key in a private session file
    Given a requester key set up with "langwatch ops setup"
    When the agent runs "langwatch ops access request" for "org:content" on ACME with a reason
    Then it prints the approval URL and waits
    And once approved it writes the session file with mode 0600
    And no ".env" file is written

  @integration
  Scenario: Normal commands use a live ops session
    Given a live ops session file
    When the agent runs "langwatch trace search"
    Then the request carries the session's key

  @integration
  Scenario: An expired ops session is ignored
    Given an ops session file whose key expired
    When the agent runs a normal command
    Then the session file is not used and the CLI says it expired

  @integration
  Scenario: The CLI ends a session early
    Given a live ops session
    When the agent runs "langwatch ops access end"
    Then the server revokes the key and the session file is removed
