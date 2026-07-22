@integration
Feature: Read the project base API key
  As a project admin
  I want the project's base (legacy) API key to be readable only by people who
  can change the project, and only for the project they were granted
  So that access to it lines up with the access it grants

  The base key is a project-level write credential. Reading it is therefore
  gated alongside changing the project (`project:update`) rather than alongside
  viewing it (`project:view`), and rotation stays at `project:manage`.

  It also travels inside the payload the application loads on every page, so
  that copy is gated on the same permission — otherwise the endpoint gates
  would decide nothing about what a client actually holds.

  Background:
    Given a project that has a base API key

  Scenario: A caller who can change the project reads the base key
    Given I have permission to update the project
    When I request the project's base API key
    Then the base API key is returned to me

  Scenario: A read-only credential cannot read the base key
    Given a credential granting only permission to view projects
    When it requests the project's base API key
    Then the request is rejected as forbidden
    And no base API key is disclosed

  Scenario: Permission is checked against the requested project
    Given I may update one project but not another in the same organization
    When I request the base API key for the project I may not update
    Then the request is rejected as forbidden
    And no base API key is disclosed to me
    And the base API key for the project I may update is still returned

  Scenario: A project in another organization is not disclosed
    Given a project belonging to an organization I am not a member of
    When I request that project's base API key
    Then the project is reported as not found
    And no base API key is disclosed to me

  Scenario: The base key stays in the session payload for those who can change the project
    Given I have permission to update the project
    When the application loads my organizations and projects
    Then the project's base API key is included in the payload

  Scenario: The base key is withheld from the session payload for read-only roles
    Given I can view the project but not update it
    When the application loads my organizations and projects
    Then the project carries no base API key in the payload

  Scenario: Listing projects never discloses base keys
    Given I have permission to update the project
    When I list the projects over the API
    Then no base API key appears in the listing

  Scenario: Reading a project never discloses its base key
    Given I have permission to update the project
    When I read that single project over the API
    Then the project is returned without its base API key
    And without its service API key
