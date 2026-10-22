Feature: Vitest's transform cache is shared across checkouts
  As a developer running tests in several git worktrees
  I want a new worktree's first run to reuse what another worktree transformed
  So that a fresh worktree does not pay for transforming every module again

  # ADR-185. The cache lives in one per-user directory, keyed by the module's
  # path relative to the workspace root, and stores the workspace root as a
  # token that each checkout replaces with its own on read.

  Background:
    Given two checkouts of the same files
    And both run Vitest with fsModuleCache against the same cache directory

  @integration
  Scenario: A second checkout's first run reads what the first checkout transformed
    Given the first checkout has run its tests
    When the second checkout runs the same tests for the first time
    Then every module is read from the cache
    And nothing is written to the cache
    And no cached file names the first checkout's path

  @integration
  Scenario: Stack traces and module paths name the checkout that runs the test
    Given the first checkout has run its tests
    When a test fails in the second checkout
    Then the stack trace names the second checkout's files at the right lines
    And import.meta paths in its modules name the second checkout

  @integration
  Scenario: A cached module whose import is missing here is transformed again
    Given the first checkout imports "./helper" from "helper.ts"
    And the second checkout has "helper/index.ts" instead
    When the second checkout runs the test
    Then the importer is transformed again
    And the test imports the second checkout's helper

  @integration
  Scenario: A run reads back the modules it cached itself
    Given a package below the workspace root
    And its test imports a workspace file and an installed package by /@fs/ path
    When the checkout runs the test with an empty cache
    Then both imports resolve to that checkout's files

  @integration
  Scenario: A suite with fsModuleCache off is untouched
    Given a package whose config turns fsModuleCache off
    When its tests import a workspace file and an installed package
    Then the copies the forks pool keeps of transformed modules name the checkout's own path
    And both imports resolve

  @integration
  Scenario: A run removes cache directories no run has used for a week
    Given the cache holds a lockfile directory unused for eight days
    And another lockfile directory used yesterday
    When a checkout runs its tests
    Then the unused directory is removed
    And the directory used yesterday is kept

  @integration
  Scenario: A lockfile change starts a new directory and leaves the other alone
    Given the cache holds a directory for another lockfile
    When a checkout with a different lockfile runs its tests
    Then its modules are written to a directory of their own
    And the other lockfile's directory is unchanged

  @integration
  Scenario: A checkout's old node_modules cache is removed
    Given a checkout with a node_modules/.vitest-cache directory
    When it runs its tests with the shared cache
    Then that directory is removed

  @integration
  Scenario: A config's fsModuleCachePath keeps its cache and leaves node_modules alone
    Given a checkout with a node_modules/.vitest-cache directory
    And a config that sets fsModuleCachePath
    When it runs its tests
    Then modules are cached at that path
    And the node_modules/.vitest-cache directory is untouched
