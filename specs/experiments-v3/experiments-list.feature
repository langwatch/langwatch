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

  # ==========================================================================
  # GET /api/experiments/{slug}
  # ==========================================================================
  # The namespace already answered POST /{slug}/run, GET /{slug}/versions and
  # GET /{slug}/workbench-state for the same slug, so the one call a reader
  # makes first, list and then fetch one, was the only one missing. It fell
  # through to the framework's own 404, whose body cannot be told apart from
  # "no such experiment", and callers concluded the experiment was gone while
  # the list was still returning it.

  Scenario: Reading one experiment answers with the same shape the list uses
    Given a valid API key in the X-Auth-Token header
    When I GET /api/experiments/checkout-flow
    Then I receive 200 OK
    And the response carries the same fields a list row carries
    And it includes the run count and the last run time

  Scenario: Either identifier the list returns can be read back
    Given a valid API key in the X-Auth-Token header
    When I GET the experiment by the id the list returned instead of the slug
    Then I receive 200 OK
    And it is the same experiment

  # The point of the route: a caller must be able to tell "there is no such
  # experiment" from "there is no such route".
  Scenario: A slug that names no experiment is refused by name
    Given a valid API key in the X-Auth-Token header
    When I GET /api/experiments/does-not-exist
    Then I receive 404 Not Found
    And the refusal carries the experiment_not_found code

  Scenario: An experiment in another project is not readable
    Given a valid API key for a different project
    When I GET /api/experiments/checkout-flow
    Then I receive 404 Not Found

  Scenario: Reading one experiment needs the project key
    Given no API key header
    When I GET /api/experiments/checkout-flow
    Then I receive 401 Unauthorized
    And the refusal comes from the key guard, not from a missing route

  # The slug is a parameter segment at the root of a namespace whose siblings
  # are literal, so it must not swallow them.
  Scenario: The runs routes keep their own handlers
    Given no API key header
    When I GET /api/experiments/runs
    Then the runs handler answers, not the read-one handler
