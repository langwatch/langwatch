Feature: Ops agent access from the CLI
  The agent uses the same `langwatch` CLI customers use. The key lives in a 0600 session file,
  never in `.env`. A normal command acts on the session only when asked with `--ops-session`.
  ADR-202.

  @integration
  Scenario: The CLI requests, waits for approval and stores the key in a private session file
    Given a requester key piped into "langwatch ops setup"
    When the agent runs "langwatch ops access request" for "org:content" on ACME with a reason
    Then it prints the approval URL and waits
    And once approved it writes the session file with mode 0600
    And no ".env" file is written

  @integration
  Scenario: The CLI keeps waiting through a status read the server failed to answer
    Given a pending access request
    When one status read fails with a server error while the approver decides
    Then the CLI keeps waiting and redeems the key once approved

  @integration
  Scenario: Setup reads the requester key from stdin
    When the agent runs "pbpaste | langwatch ops setup" with the key on the clipboard
    Then the key is stored in a 0600 file beside the CLI config
    And with nothing on stdin the command is refused and names the stdin form

  @integration
  Scenario: The requester key is never taken as an argument
    When the agent runs "langwatch ops setup --requester-key <key>"
    Then the command is refused as an unknown option and nothing is stored

  @integration @unit
  Scenario: A normal command ignores a live ops session
    Given a live ops session file
    And the folder's ".env" holds its own LANGWATCH_API_KEY
    When the agent runs "langwatch trace search"
    Then the request carries the folder's key, exactly as with no ops session
    And the CLI says how to run the command on the session

  @integration @unit
  Scenario: A command run with --ops-session uses the session and says so
    Given a live ops session file
    When the agent runs "langwatch trace search --ops-session"
    Then the request carries the session's key
    And the CLI prints which session, organization and project it acts on

  @integration
  Scenario: An ops command uses the session and says so
    Given a live ops session holding an ops token
    When the agent runs "langwatch ops orgs"
    Then the request carries the session's ops token
    And the CLI prints which session it acts on
    And the listing shows the ID, Slug and Name columns

  @integration @unit
  Scenario: An expired ops session is refused, never replaced by other credentials
    Given an ops session file whose key expired
    When the agent runs a normal command with "--ops-session"
    Then the command fails and says the session expired
    And no request is sent with other credentials
    And the session file is removed

  @integration
  Scenario: The CLI ends a session early
    Given a live ops session
    When the agent runs "langwatch ops access end"
    Then the server revokes the key and the session file is removed
