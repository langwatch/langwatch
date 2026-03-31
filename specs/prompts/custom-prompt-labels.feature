Feature: Custom prompt label definitions (CRUD)
  As an org admin
  I want to create custom labels beyond the built-in "production" and "staging"
  So that my team can tag prompt versions for additional environments like "canary" or "ab-test"

  Background:
    Given I am authenticated as an org admin for "my-org"
    And the org has a project "my-project" with a prompt "pizza-prompt" (v1, v2, v3)

  # --- Create ---

  @integration
  Scenario: Create a custom label
    When I POST /api/orgs/:orgId/prompt-labels with name "canary"
    Then the response status is 201
    And the response body contains an id and name "canary"

  @integration
  Scenario: Reject numeric label names
    When I POST /api/orgs/:orgId/prompt-labels with name "42"
    Then the request is rejected with a validation error
    And the error mentions that label names must not be numeric

  @integration
  Scenario: Reject empty label names
    When I POST /api/orgs/:orgId/prompt-labels with name ""
    Then the request is rejected with a validation error

  @integration
  Scenario: Reject label names with invalid characters
    When I POST /api/orgs/:orgId/prompt-labels with name "my label"
    Then the request is rejected with a validation error
    When I POST /api/orgs/:orgId/prompt-labels with name "can/ary"
    Then the request is rejected with a validation error
    When I POST /api/orgs/:orgId/prompt-labels with name "CANARY"
    Then the request is rejected with a validation error

  @integration
  Scenario: Reject duplicate label names within the same org
    Given a custom label "canary" exists
    When I POST /api/orgs/:orgId/prompt-labels with name "canary"
    Then the request is rejected with a conflict error

  @integration
  Scenario: Reject label names that clash with built-in labels
    When I POST /api/orgs/:orgId/prompt-labels with name "production"
    Then the request is rejected with a validation error
    And the error mentions that "production" is a built-in label

  # --- Assign custom labels (existing endpoints) ---

  @integration
  Scenario: Assign a custom label to a prompt version
    Given a custom label "canary" exists
    When I assign "canary" to v2 of "pizza-prompt"
    Then fetching "pizza-prompt" with label "canary" returns v2

  # --- List ---

  @integration
  Scenario: List labels includes built-in and custom
    Given custom labels "canary" and "ab-test" exist
    When I GET /api/orgs/:orgId/prompt-labels
    Then the response includes labels "latest", "production", "staging", "canary", "ab-test"
    And built-in labels are marked as type "built-in"
    And custom labels are marked as type "custom"

  @integration
  Scenario: List labels for an org with no custom labels
    When I GET /api/orgs/:orgId/prompt-labels
    Then the response includes only "latest", "production", "staging"

  # --- Delete ---

  @integration
  Scenario: Delete a custom label removes the definition
    Given a custom label "canary" exists with no assignments
    When I DELETE /api/orgs/:orgId/prompt-labels/:labelId
    Then the response status is 204
    And the label "canary" no longer exists

  @integration
  Scenario: Delete a custom label cascades to assignments
    Given a custom label "canary" exists
    And "canary" is assigned to v2 of "pizza-prompt"
    When I DELETE /api/orgs/:orgId/prompt-labels/:labelId
    Then the "canary" assignment on "pizza-prompt" is cleared

  @integration
  Scenario: Cannot delete built-in labels
    When I attempt to DELETE the "production" built-in label
    Then the request is rejected with a validation error
    And the error mentions that built-in labels cannot be deleted

  # --- Authorization ---

  @integration
  Scenario: Non-admin cannot create custom labels
    Given I am authenticated as a viewer for "my-org"
    When I POST /api/orgs/:orgId/prompt-labels with name "canary"
    Then the request is rejected with a 403 forbidden error

  @integration
  Scenario: Labels are scoped to the org on list
    Given org "other-org" has a custom label "canary"
    When I GET /api/orgs/:orgId/prompt-labels for "my-org"
    Then the response does not include "canary"

  @integration
  Scenario: Cannot delete another org's label
    Given org "other-org" has a custom label "canary"
    When I attempt to DELETE the "canary" label using other-org's label ID
    Then the request is rejected
