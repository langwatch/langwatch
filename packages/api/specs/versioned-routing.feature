# See ../adrs/002-explicit-version-namespaces.md
Feature: Explicit compatibility version namespaces

  As an integrator
  I want every createService family to answer at /api/v1/{thing} and at
  /api/{thing}, with its dated and latest namespaces still reachable
  So that the URL I read in the documentation is the URL I should call, and
  nothing I already call stops answering

  Background:
    Given a service "things" with endpoints registered at "2026-01-15"
    And an override of one endpoint registered at "2026-08-07"

  @unit
  Scenario: A dated URL is served by the latest registration on or before it
    When a caller requests /api/things/2026-03-01/things.list
    Then the "2026-01-15" registration answers
    And the response carries X-API-Version "2026-03-01"

  @unit
  Scenario: The latest namespace serves the newest registrations
    When a caller requests /api/things/latest/things.list
    Then the "2026-08-07" registration answers
    And the response carries X-API-Version-Status "latest"

  @unit
  Scenario: The preview namespace is separate from latest
    Given an endpoint registered only at preview
    When a caller requests it under latest
    Then it is not found
    And under preview it answers with X-API-Version-Status "preview"

  @unit
  Scenario: The bare path serves the latest registrations
    When a caller requests /api/things/things.list with no version segment
    Then the "2026-08-07" registration answers
    And the response carries X-API-Version-Status "latest"

  @unit
  Scenario: Every family answers at its /api/v1 path and its bare path
    When a caller requests /api/v1/things/things.list
    Then the same handler answers as at /api/things/things.list
    And both mounts carry the same access policy
    And the mount is reported once, carrying /api/v1/things/things.list as its
      canonical path

  @unit
  Scenario: A family already under /api/v1 is mounted once
    Given a family whose base path is /api/v1/agents
    When its routes are mounted
    Then no route is mounted at /api/v1/v1/agents
    And the family answers only at /api/v1/agents

  @unit
  Scenario: The dated and latest namespaces answer under both prefixes
    When a caller requests /api/v1/things/2026-03-01/things.list
    Then the "2026-01-15" registration answers
    And /api/v1/things/latest/things.list serves the "2026-08-07" registration
    And the same two URLs answer without the /v1 segment

  @unit
  Scenario: An unknown version namespace is rejected
    When a caller requests /api/things/2026-13-99/things.list
    Then the answer is 404 from the namespace guard
    And /api/v1/things/2026-13-99/things.list answers 404 from the same guard

  @unit
  Scenario: Withdrawal answers 410 from its version onward
    Given "things.get" withdrawn at "2026-08-07"
    Then /api/things/2026-08-07/things.get answers 410 Gone
    And /api/things/2026-01-15/things.get still answers
    And the 410 response carries the version headers

  @unit
  Scenario: Errors carry the version headers too
    When a request fails validation under a dated namespace
    Then the error response carries X-API-Version and X-API-Version-Status

  @integration
  Scenario: The document carries every dated version plus latest
    Given the service declares documentable endpoints
    When the OpenAPI document is generated
    Then it contains a path for /api/things/2026-01-15/things.list
    And a path for /api/things/2026-08-07/things.list
    And a path for /api/things/latest/things.list
    And each version's schemas are the ones that version serves

  @integration
  Scenario: Preview never reaches the document
    Given an endpoint registered only at preview
    When the OpenAPI document is generated
    Then no documented path contains the preview namespace

  @integration
  Scenario: One logical route reaches the document once
    When the OpenAPI document is generated
    Then the bare path carries the declared operation id
    And the latest namespace's operation id is suffixed "latest"
    And no /api/v1 twin appears as a second operation
