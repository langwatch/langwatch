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
    Then the response includes pagination metadata

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
