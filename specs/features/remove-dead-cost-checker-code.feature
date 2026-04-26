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

  @integration @unimplemented
  Scenario: getCurrentMonthCost remains available in the repository
    Given a LicenseEnforcementRepository instance
    When getCurrentMonthCost is called with an organization ID
    Then it returns the summed cost for the current calendar month

  @integration @unimplemented
  Scenario: UsageStatsService still reports current month cost on the dashboard
    Given a UsageStatsService backed by a repository that returns cost data
    When usage stats are fetched for an organization
    Then the response includes the current month cost from getCurrentMonthCost

  # ── Existing tests updated ─────────────────────────────────────────────
