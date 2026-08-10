@integration
Feature: Groups REST API
  As an organization admin
  I want to manage groups via the REST API
  So that I can programmatically control access groups

  Background:
    Given I am authenticated with an organization API key
    And I have organization:manage permission

  # ── List groups ─────────────────────────────────────────────────────────────

  @unit
  Scenario: GET /api/groups lists all groups
    Given the organization has groups "Engineering" and "Design"
    When I send GET /api/groups
    Then the response status is 200
    And the response includes both groups with member counts and bindings

  @unit
  Scenario: GET /api/groups returns paginated results
    When I send GET /api/groups?page=1&limit=10
    Then the response status is 200
    And the response includes pagination metadata

  @unit
  Scenario: GET /api/groups returns 401 without auth
    Given I have no authentication
    When I send GET /api/groups
    Then the response status is 401

  # ── Create group ────────────────────────────────────────────────────────────

  @unit
  Scenario: POST /api/groups creates a group
    When I send POST /api/groups with name "Backend Team"
    Then the response status is 201
    And the response includes the group with a generated slug

  @unit
  Scenario: POST /api/groups creates a group with initial members and bindings
    Given user "alice" exists in the organization
    And team "Engineering" exists
    When I send POST /api/groups with:
      | field     | value                                    |
      | name      | Full Team                                |
      | memberIds | ["alice-user-id"]                        |
      | bindings  | [{"role":"MEMBER","scopeType":"TEAM","scopeId":"eng-team-id"}] |
    Then the response status is 201
    And the group has 1 member
    And the group has 1 binding

  @unit
  Scenario: POST /api/groups returns 422 for missing name
    When I send POST /api/groups with empty name
    Then the response status is 422

  # ── Get group ───────────────────────────────────────────────────────────────

  @unit
  Scenario: GET /api/groups/:id returns group with members and bindings
    Given group "Engineering" exists with members and bindings
    When I send GET /api/groups/:id
    Then the response status is 200
    And the response includes members with userId, name, and email
    And the response includes bindings with role, scopeType, and scopeName

  @unit
  Scenario: GET /api/groups/:id returns 404 for nonexistent group
    When I send GET /api/groups/nonexistent
    Then the response status is 404

  # ── Update group ────────────────────────────────────────────────────────────

  @unit
  Scenario: PATCH /api/groups/:id renames a group
    Given group "Old Name" exists
    When I send PATCH /api/groups/:id with name "New Name"
    Then the response status is 200
    And the response includes name "New Name" and an updated slug

  @unit
  Scenario: PATCH /api/groups/:id rejects rename of SCIM-managed group
    Given group "SCIM Group" is SCIM-managed
    When I send PATCH /api/groups/:id with name "Renamed"
    Then the response status is 400
    And the error message indicates SCIM groups cannot be renamed

  # ── Delete group ────────────────────────────────────────────────────────────

  @unit
  Scenario: DELETE /api/groups/:id deletes a group
    Given group "Temporary" exists
    When I send DELETE /api/groups/:id
    Then the response status is 200
    And the group is no longer accessible via GET

  @unit
  Scenario: DELETE /api/groups/:id returns 404 for nonexistent group
    When I send DELETE /api/groups/nonexistent
    Then the response status is 404

  # ── Members ─────────────────────────────────────────────────────────────────

  @unit
  Scenario: GET /api/groups/:id/members lists group members
    Given group "Engineering" has members "alice" and "bob"
    When I send GET /api/groups/:id/members
    Then the response status is 200
    And the response includes 2 members with userId, name, and email

  @unit
  Scenario: POST /api/groups/:id/members adds a member
    Given group "Engineering" exists
    And user "charlie" exists in the organization
    When I send POST /api/groups/:id/members with userId "charlie"
    Then the response status is 201

  @unit
  Scenario: POST /api/groups/:id/members rejects adding to SCIM-managed group
    Given group "SCIM Group" is SCIM-managed
    When I send POST /api/groups/:id/members with userId "charlie"
    Then the response status is 400

  @unit
  Scenario: POST /api/groups/:id/members rejects non-org user
    Given group "Engineering" exists
    And user "outsider" does not belong to the organization
    When I send POST /api/groups/:id/members with userId "outsider"
    Then the response status is 400

  @unit
  Scenario: DELETE /api/groups/:id/members/:userId removes a member
    Given group "Engineering" has member "alice"
    When I send DELETE /api/groups/:id/members/alice-id
    Then the response status is 200
    And "alice" is no longer a member of the group

  @unit
  Scenario: DELETE /api/groups/:id/members/:userId rejects removal from SCIM group
    Given group "SCIM Group" is SCIM-managed with member "alice"
    When I send DELETE /api/groups/:id/members/alice-id
    Then the response status is 400

  # ── Bindings ────────────────────────────────────────────────────────────────

  @unit
  Scenario: GET /api/groups/:id/bindings lists group role bindings
    Given group "Engineering" has a MEMBER binding on team "Backend"
    When I send GET /api/groups/:id/bindings
    Then the response status is 200
    And the response includes the binding with role, scopeType, scopeId, and scopeName

  @unit
  Scenario: POST /api/groups/:id/bindings adds a role binding
    Given group "Engineering" exists
    And team "Frontend" exists in the same organization
    When I send POST /api/groups/:id/bindings with:
      | field     | value     |
      | role      | MEMBER    |
      | scopeType | TEAM      |
      | scopeId   | frontend-team-id |
    Then the response status is 201

  @unit
  Scenario: POST /api/groups/:id/bindings rejects cross-org scope
    Given group "Engineering" exists
    And team "External" belongs to a different organization
    When I send POST /api/groups/:id/bindings with scopeId of "External"
    Then the response status is 400

  @unit
  Scenario: DELETE /api/groups/:id/bindings/:bindingId removes a binding
    Given group "Engineering" has binding "rb_123"
    When I send DELETE /api/groups/:id/bindings/rb_123
    Then the response status is 200
    And the binding is removed

  @unit
  Scenario: DELETE /api/groups/:id/bindings/:bindingId returns 404 for nonexistent binding
    When I send DELETE /api/groups/:id/bindings/nonexistent
    Then the response status is 404

  # ── Trust boundaries and reachability ───────────────────────────────────────
  #
  # A group binding is a grant, so every id in it has to belong to the caller's
  # organization and to a role people are allowed to hold. Two references were
  # taken on trust: a custom role from another organization, and the internal
  # role a service API key carries. Both were bindable, and the resolver then
  # honored them, so the validation and the resolution are pinned separately.
  #
  # The family also has to be reachable at all. Its routes were documented and
  # implemented while nothing mounted them, so every documented call answered
  # 404 in production.

  @integration
  Scenario: A custom role from another organization cannot be bound to a group
    Given group "Engineering" exists
    And a custom role belongs to a different organization
    When I send POST /api/groups/:id/bindings with that role
    Then the request is refused with code custom_role_not_assignable and status 422
    And the group gains no binding

  @integration
  Scenario: An API key's system role cannot be bound to a group
    Given group "Engineering" exists
    And a role reserved for service API keys exists in the organization
    When I send POST /api/groups/:id/bindings with that role
    Then the request is refused with code custom_role_not_assignable and status 422
    And the group gains no binding

  @unit
  Scenario: A poisoned cross-organization binding does not grant access
    Given a group binding that names a role from another organization
    When a member's permissions are resolved through that group
    Then the foreign role contributes no permissions
    And the member's access is what their own organization granted them

  # An API key's private permission role backs only the key it was minted for.
  # A binding from one key to another key's role would otherwise read that
  # role's permissions straight onto the wrong key, so the resolver refuses it
  # at read time as well as at write time.
  @unit
  Scenario: A poisoned cross-key binding does not inherit the other key's permissions
    Given a binding from one API key that names another key's private role
    When that key's permissions are resolved
    Then the other key's private role contributes no permissions

  @integration
  Scenario: The groups API is reachable through the composed router
    When I send GET /api/groups with an organization credential
    Then the response status is 200, not 404
    And the body is the group list the endpoint documents
