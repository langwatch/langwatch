Feature: Teams REST API

  As an admin using the LangWatch API
  I want to manage teams via REST endpoints
  So that I can automate team provisioning and cleanup

  Background:
    Given an organization exists
    And I am authenticated with an org-scoped API key

  # ============================================================================
  # Authentication
  # ============================================================================

  @integration
  Scenario: Rejects unauthenticated requests
    When I call GET /api/teams without an auth header
    Then the response status is 401

  @integration
  Scenario: Rejects invalid API key
    When I call GET /api/teams with an invalid Bearer token
    Then the response status is 401

  # ============================================================================
  # Create
  # ============================================================================

  @integration
  Scenario: Creates a team
    When I POST /api/teams with name "My Test Team"
    Then the response status is 201
    And the response contains a team id starting with "team_"
    And the response contains the name, slug, organizationId, createdAt, updatedAt

  @integration
  Scenario: Rejects create when name is missing
    When I POST /api/teams with an empty body
    Then the response status is 422

  @integration
  Scenario: Rejects create when name is empty
    When I POST /api/teams with name ""
    Then the response status is 422

  @integration
  Scenario: Rejects create when name exceeds 255 characters
    When I POST /api/teams with a name longer than 255 characters
    Then the response status is 422

  # ============================================================================
  # List
  # ============================================================================

  @integration
  Scenario: Lists non-archived teams for the organization
    When I GET /api/teams
    Then the response status is 200
    And the response contains a paginated data array

  @integration
  Scenario: Paginates team list
    When I GET /api/teams with page=1 and limit=2
    Then the response pagination limit is 2

  @integration
  Scenario: Excludes teams from other organizations
    Given a team exists in a different organization
    When I GET /api/teams
    Then the response contains only teams from my organization

  # ============================================================================
  # Get by ID
  # ============================================================================

  @integration
  Scenario: Returns a team by id
    Given a team exists in my organization
    When I GET /api/teams/:id
    Then the response status is 200
    And the response contains the team

  @integration
  Scenario: Returns 404 for non-existent team
    When I GET /api/teams/team_doesnotexist
    Then the response status is 404

  @integration
  Scenario: Returns 404 for team in another organization
    Given a team exists in a different organization
    When I GET /api/teams/:otherId
    Then the response status is 404

  # ============================================================================
  # Update
  # ============================================================================

  @integration
  Scenario: Updates team name
    Given a team exists in my organization
    When I PATCH /api/teams/:id with name "Updated Name"
    Then the response status is 200
    And the response name is "Updated Name"

  @integration
  Scenario: Returns 404 when updating non-existent team
    When I PATCH /api/teams/team_ghost with name "Whatever"
    Then the response status is 404

  # ============================================================================
  # Delete (archive)
  # ============================================================================

  @integration
  Scenario: Archives a team
    Given a team exists in my organization
    When I DELETE /api/teams/:id
    Then the response status is 200
    And the response contains archivedAt

  @integration
  Scenario: Archived team is inaccessible via GET
    Given a team has been archived
    When I GET /api/teams/:id
    Then the response status is 404

  @integration
  Scenario: Archived team is excluded from list
    Given a team has been archived
    When I GET /api/teams
    Then the archived team is not in the response

  @integration
  Scenario: Returns 404 when deleting non-existent team
    When I DELETE /api/teams/team_nope
    Then the response status is 404

  @integration
  Scenario: Returns 404 when deleting already-archived team
    Given a team has been archived
    When I DELETE /api/teams/:id
    Then the response status is 404

  # ============================================================================
  # Permission denial
  # ============================================================================

  @integration
  Scenario: Viewer cannot list teams
    Given I am authenticated with a viewer-scoped API key
    When I GET /api/teams
    Then the response status is 403

  @integration
  Scenario: Viewer cannot create a team
    Given I am authenticated with a viewer-scoped API key
    When I POST /api/teams with name "Blocked Team"
    Then the response status is 403

  @integration
  Scenario: Viewer cannot update a team
    Given I am authenticated with a viewer-scoped API key
    And a team exists in my organization
    When I PATCH /api/teams/:id with name "Nope"
    Then the response status is 403

  @integration
  Scenario: Viewer cannot delete a team
    Given I am authenticated with a viewer-scoped API key
    And a team exists in my organization
    When I DELETE /api/teams/:id
    Then the response status is 403
