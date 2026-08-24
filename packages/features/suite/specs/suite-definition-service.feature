Feature: Suite definition service
  The Suite feature owns run-plan definitions independently from execution.

  Scenario: Create a suite definition
    Given a project has no suite with the requested slug
    When a caller creates a suite definition
    Then the service stores a suite with a generated id and slug

  Scenario: Reject a colliding suite definition name
    Given a project already has a suite with the requested slug
    When a caller creates a suite definition
    Then the service reports that the suite name is taken

  Scenario: Read a missing suite definition
    Given a suite definition does not exist in the project
    When a caller requests that suite
    Then the service reports that the suite was not found
