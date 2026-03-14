Feature: Studio publish and optimize resolve the correct workflow version
  As a studio user
  I want Publish and Optimize to resolve the current version consistently with Evaluate
  So that all three components agree on which version to act on

  Background:
    Given a workflow exists in the studio with a saved version

  @integration
  Scenario: Publish resolves the version from the workflow store
    Given the workflow store has a current version set
    When the Publish component resolves which version to publish
    Then it uses the version from the workflow store

  @integration
  Scenario: Optimize resolves the version from the workflow store
    Given the workflow store has a current version set
    When the Optimize component resolves which version to optimize
    Then it uses the version from the workflow store

  @integration
  Scenario: Components treat an empty version as not set
    Given the workflow store has the current version set to an empty string
    When a component checks whether a version is available
    Then it treats the version as not set
