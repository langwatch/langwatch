Feature: Archiving scenario runs requires an explicit scenario set
  As a platform owner
  I do not want a single API call to be able to archive every simulation run
  in a project
  So that an accidental or misissued bulk request cannot wipe a tenant's
  scenario history.

  Background: A project-wide "delete all" footgun existed — DELETE
  /api/scenario-events took no input and archived every simulation run for
  the authenticated project. The endpoint now requires a scenarioSetId; an
  unscoped request is refused, and the archive reports how much work it did.

  @integration
  Scenario: DELETE without scenarioSetId returns 400
    Given an authenticated request to DELETE /api/scenario-events
    When the request carries no scenarioSetId
    Then the response status is 400
    And no simulation run is archived

  @integration
  Scenario: DELETE with empty scenarioSetId returns 400
    Given an authenticated request to DELETE /api/scenario-events
    When the request carries an empty scenarioSetId
    Then the response status is 400
    And no simulation run is archived

  @integration
  Scenario: Archiving one set leaves runs in other sets untouched
    Given runs exist in more than one scenario set in the project
    When the caller archives one set by scenarioSetId
    Then only that set's runs are archived
    And the response reports the archived and failed counts and the set id

  @integration
  Scenario: Archiving the default set matches both default and empty set ids
    Given runs exist with scenarioSetId "default" and with a legacy empty set id
    When the caller archives the "default" set
    Then both the default and the legacy empty-set runs are selected for archive

  @integration
  Scenario: Reaching the 10k cap reports hasMore true
    Given the run-id lookup for a set hits its cap
    When the caller archives that set
    Then the response reports hasMore true so the caller can re-issue

  @integration
  Scenario: A failed deleteRun is collected, not short-circuited
    Given several runs match the scenario set
    And one run's archive dispatch fails
    When the caller archives the set
    Then the remaining runs are still archived
    And the failure is counted in the response

  @integration @unimplemented
  Scenario: OpenAPI documents scenarioSetId as required and the archive response shape
    Given the generated OpenAPI spec for DELETE /api/scenario-events
    Then scenarioSetId is documented as a required query parameter
    And the 200 response documents archived, failed, scenarioSetId, and hasMore

  # --- AC coverage map (issue #3635) ---
  # AC1 required scenarioSetId / 400: "DELETE without scenarioSetId returns 400" + "DELETE with empty scenarioSetId returns 400"
  # AC2 getRunIdsForSet + expandSetIdFilter + 10k cap: "Archiving the default set matches both default and empty set ids" + "Reaching the 10k cap reports hasMore true"
  # AC3 bounded-concurrency replaces Promise.all: "A failed deleteRun is collected, not short-circuited"
  # AC4 failure collection + { archived, failed, scenarioSetId, hasMore }: "Archiving one set leaves runs in other sets untouched" + "A failed deleteRun is collected, not short-circuited" + "Reaching the 10k cap reports hasMore true"
  # AC5 unfiltered path removed: "DELETE without scenarioSetId returns 400"
  # AC6 integration two sets + default coalesce: "Archiving one set leaves runs in other sets untouched" + "Archiving the default set matches both default and empty set ids"
  # AC7 OpenAPI doc: "OpenAPI documents scenarioSetId as required and the archive response shape" (@unimplemented — verified by describeRoute + archiveResponseSchema in code)
