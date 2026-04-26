Feature: Custom prompt tag management
  As an org admin
  I want to create, list, and delete custom prompt tags
  So that my team can organize prompt versions beyond the default labels

  Background:
    Given an organization exists with seeded prompt tags "production" and "staging"
    And I am an admin of that organization

  # --- Protected tags ---

  @integration @unimplemented
  Scenario: Assigning a tag that was deleted fails
    Given the "production" tag was deleted
    When I assign the "production" tag to a prompt version
    Then the assignment fails with an invalid tag error
