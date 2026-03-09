Feature: E2E Test Infrastructure
  As a developer working on LangWatch
  I want a reliable e2e test setup that works locally and on CI
  So that I can write and run end-to-end tests with confidence

  # ============================================================================
  # E2E: Happy Paths — Full Developer Workflows
  # ============================================================================

  @e2e
  Scenario: Run e2e tests locally with a single command
    Given I have Docker running on my machine
    And I am in the repository root
    When I run "make test-e2e"
    Then the test infrastructure starts up automatically
    And the database is migrated
    And the app is built and started
    And the Playwright tests execute against the running app
    And I see a test results summary when tests complete

  @e2e
  Scenario: Scenario archive e2e test passes as proof of working setup
    Given the e2e test environment is running
    When I run the scenario archive test suite
    Then the "archive a single scenario via row action menu" test passes
    And the "batch archive multiple selected scenarios" test passes

  @e2e
  Scenario: E2e tests pass on CI via GitHub Actions
    Given a pull request touches files in "langwatch/" or "agentic-e2e-tests/"
    When the e2e-ci workflow runs on GitHub Actions
    Then infrastructure services start via GitHub Actions service containers
    And the app is built and started
    And the Playwright tests execute successfully
    And test reports are uploaded as workflow artifacts

  # ============================================================================
  # Integration: Local Environment Setup
  # ============================================================================

  @integration
  Scenario: Make target orchestrates full e2e lifecycle
    Given the Makefile has a "test-e2e" target
    When "make test-e2e" is invoked
    Then it starts infrastructure services via docker compose
    And it waits for services to be healthy
    And it runs database migrations against the test database
    And it builds the Next.js app
    And it starts the app on port 5570
    And it runs Playwright tests from the agentic-e2e-tests directory
    And it tears down services when tests finish

  @integration
  Scenario: Test infrastructure uses isolated ports to avoid dev conflicts
    Given the e2e docker compose configuration is loaded
    Then the test app runs on port 5570 instead of dev port 5560
    And the test database runs on port 5433 instead of dev port 5432
    And the test Redis runs on port 6380 instead of dev port 6379
    And the test OpenSearch runs on port 9201 instead of dev port 9200

  @integration
  Scenario: Global setup validates environment before running tests
    Given the e2e test environment is not running
    When Playwright global setup executes
    Then it checks that the app is reachable at the configured base URL
    And it retries with backoff until the app responds or times out
    And it fails with a helpful error message if the app is unreachable

  @integration
  Scenario: Authentication setup creates test user automatically
    Given the e2e test environment is running with a fresh database
    When the auth setup project runs before tests
    Then it registers a test user via the registration API
    And it signs in through the UI
    And it saves the session state for reuse by subsequent tests
    And subsequent tests run in an authenticated context

  # ============================================================================
  # Integration: CI Workflow Configuration
  # ============================================================================

  @integration
  Scenario: CI workflow triggers on relevant file changes
    Given the e2e-ci workflow is configured
    Then it triggers on pushes to main
    And it triggers on pull requests that change "langwatch/" files
    And it triggers on pull requests that change "agentic-e2e-tests/" files
    And it triggers on pull requests that change the workflow file itself
    And it supports manual trigger via workflow_dispatch

  @integration
  Scenario: CI workflow uploads artifacts on failure for debugging
    Given the e2e-ci workflow has completed with test failures
    Then the Playwright HTML report is uploaded as an artifact
    And test result traces and screenshots are uploaded as artifacts
    And artifacts are retained for 7 days

  @integration
  Scenario: CI uses concurrency control to avoid redundant runs
    Given multiple commits are pushed to the same branch
    Then only the latest workflow run continues
    And previous runs for the same branch are cancelled

  # ============================================================================
  # Integration: Test Runner Configuration
  # ============================================================================

  @integration
  Scenario: Tests run sequentially with a single worker
    Given the Playwright configuration is loaded
    Then fullyParallel is disabled
    And the worker count is set to 1
    And tests use Chromium only

  @integration
  Scenario: Tests retry on CI but not locally
    Given the Playwright configuration is loaded
    When running in CI
    Then tests retry up to 2 times on failure
    When running locally
    Then tests do not retry on failure

  @integration
  Scenario: Test artifacts are captured on failure
    Given the Playwright configuration is loaded
    Then traces are retained on failure
    And screenshots are taken only on failure
    And video is retained on failure
