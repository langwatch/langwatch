Feature: Custom roles REST API

  As an operator provisioning LangWatch from code
  I want to define and edit custom roles over REST
  So that an organization's permission model can be kept in version control

  Background:
    Given an organization on an Enterprise plan
    And I am authenticated with an organization-scoped API key

  # A role is addressed by id, but its name is the natural key an infrastructure
  # tool keys on, so a taken name comes back as a deterministic conflict rather
  # than a second role with the same name. Every lookup is scoped to the
  # caller's organization: a role from elsewhere is not found, never borrowed.

  # ============================================================================
  # List and create
  # ============================================================================

  @integration
  Scenario: Listing custom roles returns the organization's roles
    Given the organization has custom roles "Release Manager" and "Auditor"
    And another organization has a custom role
    When I list roles
    Then the response status is 200
    And both of my organization's roles are returned with their permissions
    And the other organization's role is absent

  @integration
  Scenario: Creating a role from permission keys succeeds
    When I create a role named "Release Manager" with permissions "project:view" and "prompts:manage"
    Then the response status is 201
    And the response carries the role id, name, description and both permissions

  @integration
  Scenario: Creating a role with an unknown permission key is refused
    When I create a role with permission "project:teleport"
    Then the request is refused with code validation_error and status 422
    And no role is created

  @integration
  Scenario: Creating a role with a taken name is refused
    Given a custom role named "Release Manager" exists
    When I create another role named "Release Manager"
    Then the request is refused with code custom_role_name_taken and status 409
    And only one role carries that name

  # ============================================================================
  # Read
  # ============================================================================

  @integration
  Scenario: Fetching a role by id returns it
    Given a custom role exists in my organization
    When I fetch that role by id
    Then the response status is 200
    And it returns every field creating the role accepted

  @integration
  Scenario: Fetching a role from another organization is refused
    Given a custom role exists in another organization
    When I fetch that role by id
    Then the request is refused with code custom_role_not_found and status 404

  # ============================================================================
  # Update and delete
  # ============================================================================

  @integration
  Scenario: Replacing a role's permission set takes effect
    Given a custom role exists with permissions "project:view" and "prompts:manage"
    When I update the role's permissions to "project:view" alone
    Then the response status is 200
    And fetching the role returns only "project:view"

  @integration
  Scenario: Deleting an unbound role succeeds
    Given a custom role exists that nothing is bound to
    When I delete that role
    Then the response status is 200
    And fetching it afterwards is refused with code custom_role_not_found and status 404

  @integration
  Scenario: Deleting a role that is still bound is refused
    Given a custom role is bound to a user on a team
    When I delete that role
    Then the request is refused with code custom_role_in_use and status 409
    And the refusal reports how many bindings still use it
    And the role still exists

  # ============================================================================
  # Permission catalog
  # ============================================================================

  @integration
  Scenario: The permission catalog lists organization-exclusive permissions
    When I list the available permissions
    Then the response status is 200
    And every permission is grouped by the resource it acts on
    And permissions that only make sense at organization scope are marked as such
