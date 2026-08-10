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
  # Personal workspaces
  # ============================================================================
  #
  # A personal team is one member's private workspace: exactly one member, its
  # owner, and exempt from the organization's team allowance on that basis. It
  # is also unrecoverable once archived, because uniqueness of one personal
  # team per (organization, owner) covers archived rows while the workspace
  # lookup skips them, so the archived team keeps the slot and provisioning can
  # neither find the workspace nor replace it.
  #
  # An org-scoped API key holds every permission these endpoints check, so the
  # refusal is on the request's merits and comes back as 403, not 401.

  @integration
  Scenario: Refuses to archive a personal team
    Given a personal team exists in my organization
    When I DELETE /api/teams/:id for the personal team
    Then the response status is 403
    And the personal team is not archived

  @integration
  Scenario: Refuses to add a member to a personal team
    Given a personal team exists in my organization
    And another member of the organization
    When I POST /api/teams/:id/members for the personal team
    Then the response status is 403
    And the personal team still has only its owner

  @integration
  Scenario: Refuses to remove a member from a personal team
    Given a personal team exists in my organization
    When I DELETE /api/teams/:id/members/:userId for its owner
    Then the response status is 403
    And the owner still holds their binding

  # Permissions at a scope are the union of every role held there, so removing
  # one binding and calling it a removal leaves the member on the team through
  # whichever role the delete did not reach.
  @integration
  Scenario: Removing a member takes every role they hold on the team
    Given a member holds two roles on the same team
    When I DELETE /api/teams/:id/members/:userId for them
    Then the response status is 200
    And they hold no binding on that team

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
