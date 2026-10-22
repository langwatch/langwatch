Feature: Record which credential authenticated an API request
  Every request that authenticates with a token records the kind of credential
  it used: an API key, a CLI login token, or a legacy project key. A browser
  request records a session. The kind and the project id go on the request's
  span (langwatch.auth.credential_type, langwatch.auth.project_id) and in a
  structured log line. The token itself is never recorded.

  A legacy project key also stamps Project.legacyApiKeyLastUsedAt, at most
  once a minute per project in each process, so operators can list the
  projects that still send legacy keys.

  @unit
  Scenario: An API key request is recorded as an API key
    Given a live API key bound to a project
    When a request resolves that key for the project
    Then the request span carries credential type "api_key" and the project id
    And the log line carries the same type and project id, and not the token

  @unit
  Scenario: A CLI login token is recorded as a CLI token
    Given a key minted by a CLI login
    When a request resolves that key for the project
    Then the request span carries credential type "cli_token"

  @unit
  Scenario: A legacy project key is recorded as a legacy project key
    Given a project's legacy key
    When a request resolves that key
    Then the request span carries credential type "legacy_project_key" and the project id

  @unit
  Scenario: A browser session is recorded as a session
    Given a browser request with a live session cookie
    When the API door verifies it
    Then the request span carries credential type "session"

  @unit
  Scenario: A token that does not resolve records nothing
    When a request presents a token that matches no key
    Then no credential type is recorded

  @unit
  Scenario: A legacy key's use stamps the project at most once a minute
    Given a project's legacy key
    When it authenticates twice within a minute
    Then the project's last legacy key use is stamped once
    And a use after the minute stamps it again

  @integration
  Scenario: The stamp lands on the project's row
    Given a project in the database
    When its legacy key use is stamped
    Then the project's legacyApiKeyLastUsedAt holds the stamp time

  @unit
  Scenario: A failed stamp does not fail the request
    Given recording the legacy key's last use fails
    When a request resolves that key
    Then the request still resolves to the project
