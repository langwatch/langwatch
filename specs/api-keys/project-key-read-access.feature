@integration
Feature: Read the project base API key
  As a project admin
  I want the project's base (legacy) API key to be readable only in an
  administrator session, and only for the project I administer
  So that access to it lines up with the access it grants

  The base key is a full-access credential for one project. Revealing it is
  therefore gated by `project:manage` in a signed-in user session. API-key
  principals cannot reveal another legacy key, even when their scope includes
  `project:manage` or they identify the project's owner.

  It also travels inside the payload the application loads on every page, so
  that copy is gated on the same permission — otherwise the endpoint gates
  would decide nothing about what a client actually holds.

  Background:
    Given a project that has a base API key

  Scenario: A signed-in project admin reads the base key
    Given I have a signed-in user session
    And I have permission to manage the project
    When I request the project's base API key
    Then the base API key is returned to me

  Scenario: A project member cannot read the base key
    Given I have a signed-in user session
    And I can update the project but not manage it
    When I request the project's base API key
    Then the request is rejected as forbidden
    And no base API key is disclosed

  Scenario: Permission is checked against the requested project
    Given I may manage one project but not another in the same organization
    When I request the base API key for the project I may not manage
    Then the request is rejected as forbidden
    And no base API key is disclosed to me
    And the base API key for the project I may manage is still returned

  Scenario: An API key principal cannot read the base key
    Given an API key principal whose scope includes permission to manage the project
    When it requests the project's base API key
    Then the request is rejected as forbidden
    And no base API key is disclosed to me

  Scenario: API key refusal happens before the project is read
    Given an API key principal
    When it requests a base API key for an unknown project id
    Then the request is rejected as forbidden
    And the response does not reveal whether that project exists

  Scenario: A project in another organization is not disclosed
    Given a project belonging to an organization I am not a member of
    When I request that project's base API key
    Then the project is reported as not found
    And no base API key is disclosed to me

  Scenario: The base key stays in the session payload for project admins
    Given I have permission to manage the project
    When the application loads my organizations and projects
    Then the project's base API key is included in the payload

  Scenario: The base key is withheld from the session payload for project members
    Given I can update the project but not manage it
    When the application loads my organizations and projects
    Then the project carries no base API key in the payload

  Scenario: Personal context remains usable when its base key is withheld
    Given I have a valid signed-in session for my personal workspace
    And I do not have permission to manage its project
    When the application loads my personal context
    Then my personal workspace is returned
    And its base API key is blank

  Scenario: Listing projects never discloses base keys
    Given I have permission to manage the project
    When I list the projects over the API
    Then no base API key appears in the listing

  Scenario: Reading a project never discloses its base key
    Given I have permission to manage the project
    When I read that single project over the API
    Then the project is returned without its base API key
    And without its service API key
