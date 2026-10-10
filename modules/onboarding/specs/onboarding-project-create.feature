Feature: Creating a project from onboarding

  `/onboarding/:team/project` creates a project in an organization the reader
  already belongs to, then opens it.

  @integration
  Scenario: Creating a project from onboarding opens the new project
    Given I belong to an organization whose workspace graph was already read
    When I create a project named "Support Bot" from the onboarding project screen
    Then the workspace graph is read again before the address changes
    And I land on the new project's address, not on the project I had open before
