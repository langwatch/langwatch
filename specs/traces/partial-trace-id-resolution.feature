@integration
Feature: Partial trace ID resolution on trace GET
  As a LangWatch user fetching a trace by ID from the API or CLI
  I want to pass a unique prefix of the trace ID and have it resolve to the full trace
  So that I can copy-paste shortened IDs from list views (like the CLI table) without re-typing the full 32-character ID

  The CLI `trace search` command truncates trace IDs to 20 characters in its
  table output for readability. Without prefix resolution, users copying that
  truncated ID into `trace get` would hit a 404. This mirrors the git-style
  shortcut where a unique prefix resolves to the full commit hash.

  Background:
    Given I am authenticated with an API key for a project
    And the project has traces stored in ClickHouse

  Scenario: Full trace ID resolves exactly
    Given a trace exists with ID "63dc535cea6335c506bc81ef3543a07d"
    When I call GET /api/traces/63dc535cea6335c506bc81ef3543a07d
    Then the response status is 200
    And the response body contains the trace with that ID

  Scenario: Unique prefix resolves to the full trace
    Given a trace exists with ID "63dc535cea6335c506bc81ef3543a07d"
    And no other trace in the project starts with "63dc535cea6335c506bc"
    When I call GET /api/traces/63dc535cea6335c506bc
    Then the response status is 200
    And the response body contains the trace "63dc535cea6335c506bc81ef3543a07d"

  Scenario: Ambiguous prefix returns 409 with the matching IDs
    Given two traces exist with IDs "abc12345def456..." and "abc12345def999..."
    When I call GET /api/traces/abc12345
    Then the response status is 409
    And the response body includes an error message mentioning "ambiguous"
    And the response body lists the matching full trace IDs

  Scenario: No match returns 404
    Given no trace in the project starts with "deadbeef"
    When I call GET /api/traces/deadbeef
    Then the response status is 404
    And the response body message is "Trace not found."

  Scenario: Prefix match is scoped to the current project
    Given project A has a trace with ID "aaaa111122223333444455556666777788889999"
    And project B has no trace starting with "aaaa1111"
    When I call GET /api/traces/aaaa1111 authenticated as project B
    Then the response status is 404

  Scenario: Too-short prefix falls through to 404
    When I call GET /api/traces/ab
    Then the response status is 404
    And the response body message is "Trace not found."

  Scenario: Non-hex input skips prefix scan and returns 404
    When I call GET /api/traces/not-a-hex-id-zzzz
    Then the response status is 404
    And the response body message is "Trace not found."

  Scenario: CLI `trace get` with truncated ID from `trace search` succeeds
    Given I run `langwatch trace search --limit 1` and copy the displayed 20-char trace ID
    When I run `langwatch trace get <that-20-char-id>`
    Then the CLI prints the full trace details for the matching trace
