Feature: Custom prompt tag management
  As an org admin
  I want to create, list, and delete custom prompt tags
  So that my team can organize prompt versions beyond the default labels

  Background:
    Given an organization exists with seeded prompt tags "production" and "staging"
    And I am an admin of that organization

  # --- Protected tags ---

  @unit
  Scenario: Only "latest" is a protected tag
    When I inspect the PROTECTED_TAGS constant
    Then it contains only "latest"

  @unit
  Scenario: Validation rejects creating a tag named "latest"
    When I validate the tag name "latest"
    Then it fails with a message mentioning "protected"

  # --- Seeded tags are regular custom tags ---

  @unit
  Scenario: Validation accepts "production" as a tag name
    When I validate the tag name "production"
    Then it does not throw

  @unit
  Scenario: Validation accepts "staging" as a tag name
    When I validate the tag name "staging"
    Then it does not throw

  @integration
  Scenario: Deleting the seeded "production" tag succeeds
    When I delete the "production" tag via the API
    Then the response status is 204
    And the "production" tag no longer appears in the org tag list

  @integration
  Scenario: Deleting the seeded "staging" tag succeeds
    When I delete the "staging" tag via the API
    Then the response status is 204
    And the "staging" tag no longer appears in the org tag list

  @integration
  Scenario: Recreating "production" after deletion succeeds
    Given the "production" tag was deleted
    When I create a tag named "production" via the API
    Then the response status is 201
    And the "production" tag appears in the org tag list

  # --- Tag validity depends on DB presence ---

  @integration
  Scenario: Assigning a tag that exists in the DB succeeds
    Given the org has a "production" tag
    When I assign the "production" tag to a prompt version
    Then the assignment succeeds

  @integration
  Scenario: Assigning a tag that was deleted fails
    Given the "production" tag was deleted
    When I assign the "production" tag to a prompt version
    Then the assignment fails with an invalid tag error

  @integration
  Scenario: Assigning a recreated tag succeeds
    Given the "production" tag was deleted
    And I create a tag named "production" via the API
    When I assign the "production" tag to a prompt version
    Then the assignment succeeds

  # --- Custom tag CRUD ---

  @integration
  Scenario: Creating a custom tag
    When I create a tag named "canary" via the API
    Then the response status is 201
    And the "canary" tag appears in the org tag list

  @integration
  Scenario: Deleting a custom tag cascades to assignments
    Given a prompt version is tagged "canary"
    When I delete the "canary" tag via the API
    Then the prompt version no longer has a "canary" assignment

  @integration
  Scenario: Creating a duplicate tag returns 409
    Given the org has a "canary" tag
    When I create a tag named "canary" via the API
    Then the response status is 409

  @integration
  Scenario: Creating "latest" via the API returns 422
    When I POST to the prompt-tags endpoint with name "latest"
    Then the response status is 422
    And the error message mentions "protected"

  # --- Org seeding ---

  @integration
  Scenario: New org gets "production" and "staging" seeded
    When a new organization is created
    Then the org has a "production" tag in the database
    And the org has a "staging" tag in the database

  # --- Validation rules ---

  @unit
  Scenario: Validation rejects empty tag names
    When I validate the tag name ""
    Then it fails with a message mentioning "empty"

  @unit
  Scenario: Validation rejects purely numeric tag names
    When I validate the tag name "42"
    Then it fails with a message mentioning "numeric"

  @unit
  Scenario: Validation rejects uppercase tag names
    When I validate the tag name "CANARY"
    Then it fails with a message mentioning "lowercase"

  @unit
  Scenario: Validation accepts well-formed custom tag names
    When I validate the tag name "canary"
    Then it does not throw

  # --- End-to-end ---

  @e2e
  Scenario: Full lifecycle of a custom tag
    When I create a tag named "canary" via the API
    And I assign the "canary" tag to a prompt version
    And I list tags for the org
    Then "canary" appears in the list
    When I delete the "canary" tag via the API
    Then "canary" no longer appears in the list
    And the prompt version no longer has a "canary" assignment

  @e2e
  Scenario: Delete and recreate a seeded tag
    When I delete the "production" tag via the API
    And I create a tag named "production" via the API
    Then the "production" tag appears in the org tag list
    And I can assign it to a prompt version
