Feature: A code agent shares one login session across the rows of a run
  As a customer whose agent must log in to an external system before it answers
  I want the login to happen once and the rows after it to reuse the session
  So that a run over a dataset does not repeat the same login for every row

  # Context: rows of an experiment or a dataset run are isolated on purpose, so
  # they can run in parallel. There is no per-batch cache and no shared-state
  # hook. The store that works today is the project's own secret store: the
  # agent writes the session there through the LangWatch SDK and reads it back
  # at the start of every row.
  #
  # The value is encrypted at rest and only a caller that can manage secrets can
  # read it, which is what makes the secret store the correct place for a
  # session token. A dataset row is the alternative and it is stored in clear,
  # so it suits a fixture and not a credential.
  #
  # The `secrets` namespace a row is given is a snapshot taken when the row is
  # prepared, so the example does not read the session from it. It asks the
  # store while the row runs. Rows that start at the same moment can still each
  # read an empty store and each log in, and the example says so rather than
  # pretending a lock could prevent it.

  Background:
    Given a stub login service that mints a session token and rejects an expired one
    And a stub LangWatch API that stores what the agent writes and serves it back

  # ===========================================================================
  # The example, executed and never merely read
  # ===========================================================================

  @integration
  Scenario: The first row logs in and stores the session
    Given no stored session for the target system
    When the committed example runs one row
    Then the stub login service received exactly one login
    And the session was written to the project secret, with the time it was issued
    And the row asked the store before it logged in
    And the row returned the answer the protected API gave

  @integration
  Scenario: A later row reuses the stored session
    Given a stored session that was issued a moment ago
    When the committed example runs another row
    Then the stub login service received no login
    And the protected API received the stored session token

  @integration
  Scenario: A row refreshes the session before it expires
    Given a stored session that is older than the freshness window
    When the committed example runs another row
    Then the stub login service received one login
    And the stored session was replaced with the new one

  @integration
  Scenario: A row reads a session stored after its own row started
    Given a row whose snapshot was taken before any session was stored
    And a session stored after that row started
    When the committed example runs that row
    Then the stub login service received no login
    And the protected API received the stored session token

  @integration
  Scenario: Rows that race each other log in at most once each
    Given no stored session for the target system
    When two rows run at the same moment
    Then no row logged in more than once
    And at least one login happened
    And both rows returned an answer
    And the session was written to the project secret

  # ===========================================================================
  # Failure modes
  # ===========================================================================

  @integration
  Scenario: A stored entry that holds no usable session is a miss
    Given a stored entry with an empty session, a session that is not text, an
      issue time in the future, an issue time that is not a number, or no entry
      shape at all
    When the committed example runs one row
    Then the row logs in rather than sending the stored value as a token
    And the row returns the answer

  @integration
  Scenario: A rejected login names the failure and keeps the password out of it
    Given the stub login service rejects the credentials
    When the committed example runs one row
    Then the row fails rather than returning an empty answer
    And the failure names the login service and the status it returned
    And the failure does not contain the password

  @integration
  Scenario: A row still answers when the session cannot be stored
    Given the stub LangWatch API rejects the write
    When the committed example runs one row
    Then the row returns the answer
    And the run reports that the session was not stored
    And the report is the agent's own fixed words, carrying nothing from the exception

  @integration
  Scenario: A store failure never prints the LangWatch API key
    Given a LangWatch API key the HTTP client refuses to put in a header
    When the committed example runs one row
    Then the run reports what the store did, in the agent's own fixed words
    And no output stream contains the key

  @integration
  Scenario: A missing secret names the secret the project has to hold
    Given the project holds no secret for the login URL
    When the committed example runs one row
    Then the row fails naming that secret
