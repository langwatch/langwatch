Feature: Python SDK API-key project authentication
  As a Python SDK user with a scoped API key
  I want the configured project to accompany credentials that cannot identify one
  So that organization- and team-scoped keys can authenticate to project endpoints

  @regression @unit
  Scenario: A configured project accompanies a new-format API key
    Given a new-format API key that is not bound to exactly one project
    And the Python SDK has a project configured
    When the SDK builds authentication headers
    Then the headers carry the configured project

  @regression @unit
  Scenario: A legacy project key remains self-identifying
    Given a legacy project key
    And the Python SDK has a project configured
    When the SDK builds authentication headers
    Then the legacy authentication header contract is unchanged
