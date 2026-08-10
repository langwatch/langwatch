Feature: Role bindings REST API

  As an operator provisioning LangWatch from code
  I want to attach roles to users, groups and API keys at a chosen scope
  So that who can do what is described entirely by the bindings I declare

  Background:
    Given an organization on an Enterprise plan
    And I am authenticated with an organization-scoped API key

  # A binding names exactly one principal: a user, a group, or an API key. It is
  # the whole access model in one row, so every reference in it is checked
  # against the caller's organization before it is written, and repeating the
  # same declaration reports the existing binding instead of creating a second.

  # ============================================================================
  # List
  # ============================================================================

  @integration
  Scenario: Listing role bindings supports principal and scope filters
    Given bindings exist for a user, a group and an API key across two teams
    When I list bindings filtered by that user
    Then the response status is 200
    And only that user's bindings are returned, each naming its principal type, id and name
    And filtering by team scope narrows the list to that team

  # ============================================================================
  # Create
  # ============================================================================

  @integration
  Scenario: Binding a role to a user at team scope succeeds
    Given a member of the organization and a team
    When I bind that member as a member of the team
    Then the response status is 201
    And the binding names the user as its principal
    And the member now has access to that team

  @integration
  Scenario: Binding a custom role to a group succeeds
    Given a group and a custom role exist in the organization
    When I bind the group to that custom role on a project
    Then the response status is 201
    And fetching the binding returns the custom role it was created with

  @integration
  Scenario: Binding a role to an API key succeeds
    Given a service API key exists in the organization
    When I bind that key as a viewer on a project
    Then the response status is 201
    And the key can read that project and cannot write to it

  # The principal is the binding's identity, so a row with none of them grants
  # access to nobody and a row with two is ambiguous about whose access it is.
  # Both are refused by the same name, before anything is written.
  @integration
  Scenario: A binding naming no principal, or more than one, is refused
    When I create a binding that names no principal at all
    Then the request is refused with code role_binding_principal_invalid and status 422
    And naming both a user and a group is refused the same way
    And no binding is created either time

  # The three principals answer the same way when they are not ours: the id is
  # a field in the request, not the resource the request addresses, so it is a
  # rejected value rather than a missing thing.
  @integration
  Scenario: Binding an API key from another organization is refused
    Given an API key exists in another organization
    When I bind that key as a viewer on one of my projects
    Then the request is refused with code api_key_not_in_organization and status 422
    And no binding is created

  @integration
  Scenario: Binding to a scope from another organization is refused
    Given a team exists in another organization
    When I bind a member of my organization to that team
    Then the request is refused with code scope_not_in_organization and status 422
    And no binding is created

  @integration
  Scenario: Binding an organization-exclusive permission at team scope is refused
    Given a custom role carrying a permission that only applies at organization scope
    When I bind a member to that role on a team
    Then the request is refused with code org_exclusive_permission_scope and status 422
    And no binding is created

  @integration
  Scenario: A duplicate binding is reported as already existing
    Given a member is already bound as a member of a team
    When I create the same binding again
    Then the request is refused with code role_binding_already_exists and status 409
    And the member still has exactly one binding on that team

  @integration
  Scenario: A binding into a personal workspace is refused
    Given a member has a personal workspace in the organization
    When I bind another member to that personal workspace
    Then the request is refused with code personal_workspace_not_managed_here and status 403
    And no binding is created

  @integration
  Scenario: The first explicit binding for a legacy user is reported in the response
    Given a member whose access comes from team membership predating explicit bindings
    When I create their first explicit binding
    Then the response status is 201
    And the response notes that their team-derived access no longer applies
    And the binding is created regardless

  # ============================================================================
  # Delete
  # ============================================================================

  @integration
  Scenario: Deleting a binding removes it
    Given a member is bound as a member of a team
    When I delete that binding
    Then the response status is 200
    And the member no longer has access to that team

  @integration
  Scenario: Deleting an unknown binding returns not found
    When I delete a binding id that does not exist
    Then the request is refused with code role_binding_not_found and status 404
