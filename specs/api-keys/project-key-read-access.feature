@integration
Feature: Read the project base API key
  As a project admin
  I want the project's base (legacy) API key to be readable only by people who
  can change the project, and only for the project they were granted
  So that access to it lines up with the access it grants

  The base key is a project-level write credential. Reading it is therefore
  gated alongside changing the project (`project:update`) rather than alongside
  viewing it (`project:view`), and rotation stays at `project:manage`.

  Background:
    Given a project that has a base API key

  Scenario: A member who can change the project reads the base key
    Given I have permission to update the project
    When I request the project's base API key
    Then the base API key is returned to me

  Scenario: A viewer cannot read the base key
    Given I can view the project but not update it
    When I request the project's base API key
    Then the request is rejected as forbidden
    And no base API key is disclosed to me

  Scenario: A lite member cannot read the base key
    Given I am an external member who can view the project
    When I request the project's base API key
    Then the request is rejected as forbidden
    And no base API key is disclosed to me

  Scenario: A read-scoped API key cannot read the base key
    Given an API key granting only read access to projects
    When that key requests a project's base API key
    Then the request is rejected as forbidden
    And no base API key is disclosed

  Scenario: Permission is checked against the requested project
    Given I can update project "alpha" but only view project "beta"
    When I request the base API key for project "beta"
    Then the request is rejected as forbidden
    And no base API key is disclosed to me

  Scenario: An organization-wide grant still reaches every project
    Given I hold permission to update projects across the whole organization
    When I request the base API key for any project in that organization
    Then the base API key is returned to me

  Scenario: A project in another organization is not disclosed
    Given a project belonging to an organization I am not a member of
    When I request that project's base API key
    Then the project is reported as not found
    And no base API key is disclosed to me

  Scenario: The base key is withheld from the session payload for read-only roles
    Given I can view the project but not update it
    When the application loads my organizations and projects
    Then the project's base API key is not included in the payload

  Scenario: The base key stays in the session payload for those who can change the project
    Given I have permission to update the project
    When the application loads my organizations and projects
    Then the project's base API key is included in the payload

  Scenario: Listing projects never discloses base keys
    Given I have permission to update the project
    When I list the projects over the API
    Then no base API key appears in the listing
    And reading a single project over the API discloses no base API key
