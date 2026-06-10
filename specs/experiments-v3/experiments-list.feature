@integration
Feature: List experiments and evaluation runs via public REST API
  As a developer using the LangWatch CLI, MCP server, or scripts
  I want public REST endpoints that enumerate my experiments and their runs
  So that I can discover experiment slugs and run ids without opening the dashboard

  Background:
    Given a project with a valid API key
    And the project owns experiments "checkout-flow" and "support-bot"

  # ==========================================================================
  # GET /api/experiments
  # ==========================================================================

  Scenario: Unauthenticated request returns 401
    Given no API key header
    When I GET /api/experiments
    Then I receive 401 Unauthorized

  Scenario: Authenticated request lists experiments scoped to the project
    Given a valid API key in the X-Auth-Token header
    When I GET /api/experiments
    Then I receive 200 OK
    And the response contains entries for "checkout-flow" and "support-bot"
    And each entry exposes "id", "slug", "name", "type", "createdAt", "updatedAt"
    And no entry from another project appears

  @unimplemented
  Scenario: Empty project returns an empty list
    Given a project with no experiments
    And a valid API key for that project
    When I GET /api/experiments
    Then I receive 200 OK
    And the experiments list is empty

  Scenario: Pagination returns the requested page
    Given the project owns 60 experiments
    When I GET /api/experiments with pageSize=25
    Then I receive 200 OK
    And the response contains 25 experiments
    And the response indicates more pages remain

  # ==========================================================================
  # GET /api/experiments/runs?experimentSlug=...
  # ==========================================================================

  Scenario: Unauthenticated runs request returns 401
    Given no API key header
    When I GET /api/experiments/runs?experimentSlug=checkout-flow
    Then I receive 401 Unauthorized

  Scenario: Missing experimentSlug returns 400
    Given a valid API key in the X-Auth-Token header
    When I GET /api/experiments/runs with no query parameters
    Then I receive 400 Bad Request
    And the response indicates "experimentSlug" is required

  Scenario: Unknown experiment slug returns 404
    Given a valid API key in the X-Auth-Token header
    When I GET /api/experiments/runs?experimentSlug=does-not-exist
    Then I receive 404 Not Found

  Scenario: Authenticated request returns runs for the experiment
    Given the experiment "checkout-flow" has 3 completed runs
    And a valid API key in the X-Auth-Token header
    When I GET /api/experiments/runs?experimentSlug=checkout-flow
    Then I receive 200 OK
    And the response contains 3 runs
    And each run exposes "runId", "experimentId", "timestamps", "summary"

  Scenario: Experiment without runs returns an empty list
    Given the experiment "support-bot" has no runs
    And a valid API key in the X-Auth-Token header
    When I GET /api/experiments/runs?experimentSlug=support-bot
    Then I receive 200 OK
    And the runs list is empty
