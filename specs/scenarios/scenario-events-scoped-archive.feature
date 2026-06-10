Feature: Archiving scenario runs always requires an explicit scope
  As a platform owner
  I do not want a single API call to be able to archive every simulation run
  in a project
  So that an accidental or misissued bulk request cannot wipe a tenant's
  scenario history.

  Background: A project-wide "delete all" footgun existed — DELETE
  /api/scenario-events took no input and archived every simulation run for
  the authenticated project. The endpoint now requires a batchRunId and/or
  scenarioSetId; an unscoped request is refused.

  @integration
  Scenario: Archiving scenario runs without a scope is rejected
    Given an authenticated request to DELETE /api/scenario-events
    When the request carries neither a batchRunId nor a scenarioSetId
    Then the response status is 400
    And no simulation run is archived

  @integration
  Scenario: Archiving scenario runs by batchRunId archives only that batch
    Given an authenticated request to DELETE /api/scenario-events with a batchRunId
    When the request is handled
    Then only the runs belonging to that batch are archived
    And runs outside the batch are left untouched
