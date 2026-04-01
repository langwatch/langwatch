Feature: Custom prompt tag definitions (CRUD)
  As an org admin
  I want to create custom tags beyond the built-in "production" and "staging"
  So that my team can tag prompt versions for additional environments like "canary" or "ab-test"

  Background:
    Given I am authenticated as an org admin for "my-org"
    And the org has a project "my-project" with a prompt "pizza-prompt" (v1, v2, v3)

  # --- Create ---

  @integration
  Scenario: Create a custom tag
    When I POST /api/orgs/:orgId/prompt-tags with name "canary"
    Then the response status is 201
    And the response body contains an id and name "canary"

  @integration
  Scenario: Reject numeric tag names
    When I POST /api/orgs/:orgId/prompt-tags with name "42"
    Then the request is rejected with a validation error
    And the error mentions that tag names must not be numeric

  @integration
  Scenario: Reject empty tag names
    When I POST /api/orgs/:orgId/prompt-tags with name ""
    Then the request is rejected with a validation error

  @integration
  Scenario: Reject tag names with invalid characters
    When I POST /api/orgs/:orgId/prompt-tags with name "my tag"
    Then the request is rejected with a validation error
    When I POST /api/orgs/:orgId/prompt-tags with name "can/ary"
    Then the request is rejected with a validation error
    When I POST /api/orgs/:orgId/prompt-tags with name "CANARY"
    Then the request is rejected with a validation error

  @integration
  Scenario: Reject duplicate tag names within the same org
    Given a custom tag "canary" exists
    When I POST /api/orgs/:orgId/prompt-tags with name "canary"
    Then the request is rejected with a conflict error

  @integration
  Scenario: Reject tag names that clash with built-in tags
    When I POST /api/orgs/:orgId/prompt-tags with name "production"
    Then the request is rejected with a validation error
    And the error mentions that "production" is a built-in tag

  # --- Assign custom tags (existing endpoints) ---

  @integration
  Scenario: Assign a custom tag to a prompt version
    Given a custom tag "canary" exists
    When I assign "canary" to v2 of "pizza-prompt"
    Then fetching "pizza-prompt" with label "canary" returns v2

  # --- List ---

  @integration
  Scenario: List tags returns all org tags
    Given custom tags "canary" and "ab-test" exist
    When I GET /api/orgs/:orgId/prompt-tags
    Then the response includes tags "canary" and "ab-test"
    And each tag has an id and createdAt

  @integration
  Scenario: List tags for an org with no custom tags
    When I GET /api/orgs/:orgId/prompt-tags
    Then the response is an empty array

  # --- Delete ---

  @integration
  Scenario: Delete a custom tag removes the definition
    Given a custom tag "canary" exists with no assignments
    When I DELETE /api/orgs/:orgId/prompt-tags/:tagId
    Then the response status is 204
    And the tag "canary" no longer exists

  @integration
  Scenario: Delete a custom tag cascades to assignments
    Given a custom tag "canary" exists
    And "canary" is assigned to v2 of "pizza-prompt"
    When I DELETE /api/orgs/:orgId/prompt-tags/:tagId
    Then the "canary" assignment on "pizza-prompt" is cleared

  @integration
  Scenario: Cannot delete protected tags
    When I attempt to DELETE the "production" protected tag
    Then the request is rejected with a validation error
    And the error mentions that protected tags cannot be deleted

  # --- Authorization ---

  @integration
  Scenario: Non-admin cannot create custom tags
    Given I am authenticated as a viewer for "my-org"
    When I POST /api/orgs/:orgId/prompt-tags with name "canary"
    Then the request is rejected with a 403 forbidden error

  @integration
  Scenario: Tags are scoped to the org on list
    Given org "other-org" has a custom tag "canary"
    When I GET /api/orgs/:orgId/prompt-tags for "my-org"
    Then the response does not include "canary"

  @integration
  Scenario: Cannot delete another org's tag
    Given org "other-org" has a custom tag "canary"
    When I attempt to DELETE the "canary" tag using other-org's tag ID
    Then the request is rejected
