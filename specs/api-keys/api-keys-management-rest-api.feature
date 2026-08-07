Feature: API keys management REST API

  As an operator provisioning LangWatch from code
  I want to read and edit an API key's access over REST
  So that a key can be created, tightened, and audited without a browser

  Background:
    Given an organization exists
    And I am authenticated with an organization-scoped API key

  # The API keys family is not gated behind Enterprise: it is an existing public
  # family, and the custom-role machinery a key can reference is already gated
  # where roles are created. What the family owes callers is a ceiling. A key
  # can only ever be edited by someone who could have created it, and never
  # widened past the access its editor holds, or "manage API keys" quietly
  # becomes "grant yourself anything".

  # ============================================================================
  # Privilege boundaries
  # ============================================================================

  @integration
  Scenario: A manage-permission holder cannot mint an unbound service key
    Given my credential holds organization:manage but is not an organization admin
    When I create a service key with no bindings
    Then the request is refused with code insufficient_permissions and status 403
    And no key is created

  @integration
  Scenario: Deleting another user's key requires organization admin rights
    Given another member of the organization owns an API key
    And my credential is not an organization admin
    When I delete that member's key
    Then the request is refused with code insufficient_permissions and status 403
    And the key still authenticates

  @integration
  Scenario: A view-only service credential cannot list every key in the organization
    Given another member of the organization owns an API key
    And I am authenticated with a service key holding only organization:view
    When I list API keys
    Then the response contains only the keys that credential may see
    And the other member's key is absent

  @integration
  Scenario: An API key cannot be bound into a personal workspace
    Given a member has a personal workspace in the organization
    When I create a key bound to that personal workspace
    Then the request is refused with code personal_workspace_not_managed_here and status 403
    And no key is created

  # ============================================================================
  # Read
  # ============================================================================

  @integration
  Scenario: Fetching an API key returns its bindings
    Given a key exists with a member binding on a team
    When I fetch that key by id
    Then the response status is 200
    And it contains the name, description, permission mode and bindings
    And it never contains the key's secret

  # Reading somebody else's key by id discloses what the organization-wide
  # listing discloses, one row at a time, so it takes the same rights. A key
  # the caller may not read answers exactly like an id that names nothing:
  # a 403 would confirm the id is real, which is what probing is after.
  @integration
  Scenario: Fetching an unknown API key returns not found
    When I fetch a key id that does not exist
    Then the request is refused with code api_key_not_found and status 404

  # ============================================================================
  # Update
  # ============================================================================

  @integration
  Scenario: Renaming an API key preserves its bindings
    Given a key exists with a member binding on a team
    When I update only its name
    Then the response status is 200
    And the new name is returned
    And the binding on the team is unchanged

  @integration
  Scenario: Replacing bindings with a tighter set takes effect
    Given a key exists with an organization-wide binding
    When I replace its bindings with a single viewer binding on one project
    Then the response status is 200
    And fetching the key returns exactly that one binding
    And the organization-wide binding is gone

  @integration
  Scenario: Setting restricted mode requires explicit permissions
    Given a key exists in the organization
    When I set its permission mode to restricted without listing permissions
    Then the request is refused with code validation_error and status 422
    And the key's permission mode is unchanged

  # The ceiling is the access of the member the key belongs to, and a caller
  # who is not an organization admin may only edit keys that are their own,
  # so for them the two are the same thing.
  @integration
  Scenario: Widening a key beyond the caller's own access is refused
    Given a key of mine exists with a viewer binding on one project
    And my credential is not an organization admin
    When I replace its bindings with an admin binding on that project
    Then the request is refused with code api_key_scope_violation and status 403
    And the key keeps its viewer binding
