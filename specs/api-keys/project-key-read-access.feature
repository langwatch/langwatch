@integration
Feature: The project base API key is never readable after it is created
  As a project admin
  I want the project's base API key to be shown only when it is created or
  rotated
  So that no session, page or API response can hand it out later

  The base key is a full-access credential for one project. Only its hash and
  its last four characters are stored, so nothing can read it back. Rotation
  returns the new key once. Every other surface that needs a key for a person
  mints a personal API key for them instead.

  Background:
    Given a project that has a base API key

  Scenario: No route reads the base key back
    Given I have a signed-in user session
    And I have permission to manage the project
    When I look for a way to read the project's base API key
    Then no route returns it

  Scenario: The base key is withheld from the session payload for project admins
    Given I have permission to manage the project
    When the application loads my organizations and projects
    Then the project's base API key is blank in the payload
    And its key hash is blank in the payload
    And its last four characters are included in the payload

  Scenario: The base key is withheld from the session payload for project members
    Given I can update the project but not manage it
    When the application loads my organizations and projects
    Then the project's base API key is blank in the payload
    And its key hash is blank in the payload

  Scenario: Team and cost payloads carry no project key material
    Given I have permission to manage the project
    When the application loads my teams, their members or their costs
    Then no project in the payload carries its base API key or key hash

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
