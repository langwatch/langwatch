Feature: Archiving scenario runs requires an explicit scenario set
  As a platform owner
  I do not want a single API call to be able to archive every simulation run
  in a project
  So that an accidental or misissued bulk request cannot wipe a tenant's
  scenario history.

  Background: A project-wide "delete all" footgun existed — DELETE
  /api/scenario-events took no input and archived every simulation run for
  the authenticated project. The endpoint now requires exactly one scope:
  a scenarioSetId (archive a whole set) or a scenarioRunId (archive one
  run). An unscoped request is refused, and the archive reports how much
  work it did.

  @integration
  Scenario: DELETE without a scope is refused
    Given an authenticated request to DELETE /api/scenario-events
    When the request carries neither scenarioSetId nor scenarioRunId
    Then the request is refused as not matching the expected shape
    And no simulation run is archived

  @unit
  Scenario: DELETE with both scenarioSetId and scenarioRunId is refused
    Given an authenticated request to DELETE /api/scenario-events
    When the request carries both a scenarioSetId and a scenarioRunId
    Then the request is refused as not matching the expected shape
    And no simulation run is archived

  @unit
  Scenario: DELETE with scenarioRunId archives exactly that run
    Given a simulation run exists in the project
    When the caller archives it by scenarioRunId
    Then only that run is archived
    And the response reports one archived run and the run id

  @unit
  Scenario: DELETE with a scenarioRunId the project does not hold is not found
    Given a scenarioRunId that does not exist in the authenticated project
    When the caller archives it by scenarioRunId
    Then the response is not found
    And no simulation run is archived

  @integration
  Scenario: DELETE with empty scenarioSetId is refused
    Given an authenticated request to DELETE /api/scenario-events
    When the request carries an empty scenarioSetId
    Then the request is refused as not matching the expected shape
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
  Scenario: One run failing to archive does not stop the others
    Given several runs match the scenario set
    And archiving one of them fails
    When the caller archives the set
    Then the remaining runs are still archived
    And the failure is counted in the response

  @integration @unimplemented
  Scenario: OpenAPI documents the two scopes and the archive response shapes
    Given the generated OpenAPI spec for DELETE /api/scenario-events
    Then scenarioSetId and scenarioRunId are documented as optional and mutually exclusive query parameters
    And the 200 response documents the set-scoped shape with archived, failed, scenarioSetId, and hasMore
    And the 200 response documents the run-scoped shape with archived and scenarioRunId
    And a request carrying no scope or both scopes is documented as 422

  # --- AC coverage map (issue #3635) ---
  # AC1 required scope: "DELETE without a scope is refused" + "DELETE with empty scenarioSetId is refused"
  # AC2 getRunIdsForSet + expandSetIdFilter + 10k cap: "Archiving the default set matches both default and empty set ids" + "Reaching the 10k cap reports hasMore true"
  # AC3 bounded-concurrency replaces Promise.all: "One run failing to archive does not stop the others"
  # AC4 failure collection + { archived, failed, scenarioSetId, hasMore }: "Archiving one set leaves runs in other sets untouched" + "One run failing to archive does not stop the others" + "Reaching the 10k cap reports hasMore true"
  # AC5 unfiltered path removed: "DELETE without a scope is refused"
  # AC6 integration two sets + default coalesce: "Archiving one set leaves runs in other sets untouched" + "Archiving the default set matches both default and empty set ids"
  # AC7 OpenAPI doc: "OpenAPI documents the two scopes and the archive response shapes" (@unimplemented — verified by describeRoute + archiveResponseSchema in code)
