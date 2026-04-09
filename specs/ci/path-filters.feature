Feature: CI path filters skip unnecessary workflows on non-code changes
  As a developer
  I want CI to skip expensive workflows when only docs, specs, or config files change
  So that PR feedback is faster and CI minutes are not wasted

  Background:
    Given the repository uses complementary workflow pairs
    And each real workflow has a matching "-unmodified" stub
    And stub job names match real workflow job names exactly

  # ============================================================================
  # Stub job name alignment (Phase 1 — fix pre-existing bugs)
  # ============================================================================

  Scenario: langwatch-app-ci stub matches real workflow job names
    Given langwatch-app-ci.yml defines jobs "typecheck", "test-unit", "test-integration", "lint", "build"
    When a PR does not touch langwatch/ files
    Then langwatch-app-ci-unmodified.yml reports success for the same job names

  Scenario: mcp-javascript-ci stub matches real workflow job names
    Given mcp-javascript-ci.yml defines jobs "typecheck", "build_and_test"
    When a PR does not touch mcp-server/ files
    Then mcp-javascript-ci-unmodified.yml reports success for the same job names

  Scenario: sdk-javascript-ci stub matches real workflow job names
    Given sdk-javascript-ci.yml defines jobs "ci", "e2e"
    When a PR does not touch typescript-sdk/ files
    Then sdk-javascript-ci-unmodified.yml reports success for the same job names

  # ============================================================================
  # Missing stubs (Phase 2)
  # ============================================================================

  Scenario: e2e-ci has a complementary stub
    Given e2e-ci.yml triggers on langwatch/ and agentic-e2e-tests/ changes
    When a PR does not touch those directories
    Then e2e-ci-unmodified.yml reports success for all e2e-ci job names

  Scenario: codeql has a complementary stub
    Given codeql.yml triggers on code file changes only
    When a PR touches only documentation or config files
    Then codeql-unmodified.yml reports success for analyze jobs

  # ============================================================================
  # Path filter behavior
  # ============================================================================

  Scenario: CodeQL skips docs-only PRs
    When a PR changes only files in docs/, .claude/, specs/, or markdown files
    Then codeql.yml does not run
    And codeql-unmodified.yml reports success for required checks

  Scenario: Push to main always runs all workflows
    When a commit is pushed to the main branch
    Then all workflows run regardless of which files changed

  # ============================================================================
  # Safety invariants
  # ============================================================================

  Scenario: No PR is permanently blocked by missing status checks
    Given all workflow pairs have matching job names
    When any combination of files is changed in a PR
    Then every required status check receives a result from either the real workflow or its stub

  Scenario: Negation patterns are not used in path filters
    Given the complementary pair system cannot support negation
    Then no workflow uses negation patterns like "!path" in paths filters
    And path exclusions are achieved only through the stub's paths-ignore
