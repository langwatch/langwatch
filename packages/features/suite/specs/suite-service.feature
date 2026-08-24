Feature: Suite service

  Scenario: Create a suite definition
    Given a project has no suite with the requested slug
    When a caller creates the suite through app.suites
    Then the service stores it with a generated id and slug

  Scenario: Reject a colliding suite name
    Given a project already has a suite with the requested slug
    When a caller creates another suite with that slug
    Then the service reports that the suite name is taken

  Scenario: Resolve a run through owning feature services
    Given a suite references scenarios, agents or prompts
    When a caller starts the suite through app.suites
    Then Suite asks the canonical owning services to resolve those references
    And its execution port schedules the durable run

  Scenario: Read a missing suite
    Given a suite does not exist in the project
    When a caller requests that suite
    Then the service reports that the suite was not found
