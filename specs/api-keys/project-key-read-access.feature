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

  Every query is cached, to the browser's disk too, so no query ever returns a
  credential: the base key, the LangWatchQL key and the storage secret are never
  in a payload a browser reads.

  Background:
    Given a project that has a base API key

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

  Scenario: No query carries a project key or the storage secret
    Given the project has a base key, a LangWatchQL key and a stored storage secret
    When the application loads my organizations and projects, whatever I may do
    Then the project's base API key is blank in the payload
    And the LangWatchQL key is blank in the payload
    And the storage secret is absent from the payload and the key id stays
    And the organization's uploaded licence key is absent from the payload

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
