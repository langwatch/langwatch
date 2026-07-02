Feature: Public REST API does not cap experimentation resources

  The Hono /public-rest-api routes for experimentation resources (prompts,
  evaluators, scenarios, agents, datasets, dashboards, custom graphs,
  automations, online evaluations, experiments) no longer carry any
  resource-limit middleware. These resources are OSS (Apache 2.0) and uncapped,
  matching the dashboard — see oss-experimentation-uncapped.feature. There is
  therefore no API path to a "limit reached" rejection for them, and no
  plan-limit notification fires from these routes.

  As a platform operator
  I want the API to match the dashboard's unlimited experimentation behavior
  So that there is a single, consistent policy regardless of entry point

  Background:
    Given an organization exists with a project
    And the project has a valid API key

  @integration @unimplemented
  Scenario: Creating many prompts via the API always succeeds
    Given the organization already has 50 prompts
    When I create another prompt via the API
    Then the prompt is created successfully
    And no plan-limit notification is sent

  @integration @unimplemented
  Scenario: Creating an evaluator via the API is never blocked by a limit
    Given the organization already has 50 evaluators
    When I create another evaluator via the API
    Then the evaluator is created successfully

  @integration @unimplemented
  Scenario: Listing prompts succeeds regardless of count
    Given the organization already has 50 prompts
    When I list prompts via the API
    Then the prompt list is returned

  @integration @unimplemented
  Scenario: Updating and deleting experimentation resources is never blocked
    Given an evaluator and a scenario exist
    When I update the evaluator and delete the scenario via the API
    Then the evaluator is updated and the scenario is archived
