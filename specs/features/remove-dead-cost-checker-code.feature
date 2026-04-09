Feature: Remove dead cost-checking code from worker paths
  As a maintainer
  I want to delete the unused ICostChecker interface, createCostChecker() factory, and all worker cost-check blocks
  So that every evaluation and clustering job no longer pays for a SUM query whose result is always discarded

  Background:
    Since Nov 2025 maxMonthlyUsageLimit() returns Infinity unconditionally.
    The cost-check blocks in the four worker call sites always evaluate
    `currentCost >= Infinity` which is always false, making the code dead.
    The repository method getCurrentMonthCost() is still used by
    UsageStatsService for the usage dashboard and must be preserved.

  # ── Interface and factory removal ──────────────────────────────────────

  @unit
  Scenario: ICostChecker interface no longer exists
    Given the license-enforcement repository module
    When the module is inspected
    Then the export "ICostChecker" does not exist

  @unit
  Scenario: createCostChecker factory no longer exists
    Given the license-enforcement repository module
    When the module is inspected
    Then the export "createCostChecker" does not exist

  # ── Worker call-site removal ───────────────────────────────────────────

  @unit
  Scenario: evaluationsWorker no longer performs cost check
    Given the evaluationsWorker module
    When the module is inspected
    Then it contains no reference to costChecker, maxMonthlyUsageLimit, or createCostChecker

  @unit
  Scenario: EvaluationExecutionService no longer depends on CostChecker
    Given the EvaluationExecutionService dependency interface
    When the interface is inspected
    Then it does not include a costChecker property
    And the class does not call maxMonthlyUsageLimit or getCurrentMonthCost

  @unit
  Scenario: evaluate API route no longer performs cost check
    Given the dataset evaluate API route
    When the module is inspected
    Then it contains no reference to costChecker, maxMonthlyUsageLimit, or createCostChecker

  @unit
  Scenario: topicClustering no longer performs cost check
    Given the topicClustering module
    When the module is inspected
    Then it contains no reference to costChecker, maxMonthlyUsageLimit, or createCostChecker

  # ── Presets wiring removal ─────────────────────────────────────────────

  @unit
  Scenario: App presets no longer wire a costChecker into EvaluationExecutionService
    Given the app-layer presets module
    When EvaluationExecutionService is constructed
    Then no costChecker argument is passed

  # ── Preserve repository method for dashboard ───────────────────────────

  @integration
  Scenario: getCurrentMonthCost remains available in the repository
    Given a LicenseEnforcementRepository instance
    When getCurrentMonthCost is called with an organization ID
    Then it returns the summed cost for the current calendar month

  @integration
  Scenario: UsageStatsService still reports current month cost on the dashboard
    Given a UsageStatsService backed by a repository that returns cost data
    When usage stats are fetched for an organization
    Then the response includes the current month cost from getCurrentMonthCost

  # ── Existing tests updated ─────────────────────────────────────────────

  @unit
  Scenario: EvaluationExecutionService unit tests remove cost-limit scenarios
    Given the evaluation-execution.service unit test file
    When the test suite is inspected
    Then there are no test cases for "cost limit exceeded" or "maxMonthlyUsageLimit"
    And the test factory no longer includes a costChecker mock

  @unit
  Scenario: topicClustering unit tests remove createCostChecker mock
    Given the topicClustering unit test file
    When the test suite is inspected
    Then there is no vi.mock for createCostChecker
