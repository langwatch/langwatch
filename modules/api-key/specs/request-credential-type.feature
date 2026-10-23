Feature: Stamp the last use of a project's legacy key
  A legacy project key that authenticates a request stamps
  Project.legacyApiKeyLastUsedAt, at most once a minute per project in each
  process, so operators can list the projects that still send legacy keys.
  Which credential a request used, and its span attributes and log line, are
  the credential census's (modules/auth/specs/request-credential-census.feature).

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
