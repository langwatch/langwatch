@unit
Feature: Fields added to a published family stay optional in its document
  As an integrator with a client generated from the API document
  I want a field a family gained after I generated my client to read as optional
  So that my client keeps parsing answers from a server that does not send it

  # /api/scenarios, /api/suites and /api/simulation-runs were published, and
  # clients were generated from them, before test suites, run notes and
  # scenario versions existed. Those features added folderId, kind, scope,
  # note and scenarioVersion to their answers. A generated client reads a
  # required field with no fallback, so marking one of them required in the
  # document breaks that client against every server that predates the field,
  # even though every current server sends it.

  Scenario: The scenario answers read folderId as optional
    When I read the generated OpenAPI document
    Then no /api/scenarios success answer lists folderId as required

  Scenario: The suite answers read kind and scope as optional
    When I read the generated OpenAPI document
    Then no /api/suites success answer lists kind as required
    And no /api/suites success answer lists scope as required

  Scenario: The simulation run answers read note and scenarioVersion as optional
    When I read the generated OpenAPI document
    Then no /api/simulation-runs success answer lists note as required
    And no /api/simulation-runs success answer lists scenarioVersion as required
