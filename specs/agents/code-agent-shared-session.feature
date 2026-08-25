Feature: A code agent shares one login session across the rows of a run
  As a customer whose agent must log in to an external system before it answers
  I want the login to happen once and the rows after it to reuse the session
  So that a run over a dataset does not repeat the same login for every row

  # Context: rows of an experiment or a dataset run are isolated on purpose, so
  # they can run in parallel. There is no per-batch cache and no shared-state
  # hook. The store that works today is the project's own secret store: the
  # platform reads every project secret from the database when it prepares each
  # row, and the REST secrets API accepts a project API key, so a code agent can
  # read a value it wrote on an earlier row.
  #
  # The value is encrypted at rest and no API returns it, which is what makes
  # the secret store the correct place for a session token. A dataset row is
  # the alternative and it is stored in clear, so it suits a fixture and not a
  # credential.
  #
  # Limit that the example must not hide: the secrets namespace a row reads is
  # a snapshot taken when that row starts. A row that misses the cache cannot
  # see a write made by a row running beside it, so the first parallel wave
  # performs one login per row in the wave. There is no lock that can prevent
  # this, and the example says so rather than pretending otherwise.

  Background:
    Given a stub login service that mints a session token and rejects an expired one
    And a stub LangWatch secrets API that stores what the agent writes

  # ===========================================================================
  # The example, executed and never merely read
  # ===========================================================================

  @integration
  Scenario: The first row logs in and stores the session
    Given no stored session for the target system
    When the committed example runs one row
    Then the stub login service received exactly one login
    And the session was written to the project secret, with the time it was issued
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
  Scenario: Two rows that start together each log in
    Given no stored session for the target system
    When two rows run against the same empty snapshot
    Then the stub login service received one login for each row
    And both rows returned an answer

  # ===========================================================================
  # Failure modes
  # ===========================================================================

  @integration
  Scenario: A rejected login names the failure and keeps the password out of it
    Given the stub login service rejects the credentials
    When the committed example runs one row
    Then the row fails rather than returning an empty answer
    And the failure names the login service and the status it returned
    And the failure does not contain the password

  @integration
  Scenario: A row still answers when the session cannot be stored
    Given the stub secrets API rejects the write
    When the committed example runs one row
    Then the row returns the answer
    And the run reports that the session was not stored
    And the report does not contain the session token

  @integration
  Scenario: A missing secret names the secret the project has to hold
    Given the project holds no secret for the login URL
    When the committed example runs one row
    Then the row fails naming that secret
