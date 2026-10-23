Feature: Vitest's transform cache is shared across checkouts
  As a developer running tests in several git worktrees
  I want a new worktree's first run to reuse what another worktree transformed
  So that a fresh worktree does not pay for transforming every module again

  # ADR-193. The cache lives in one per-user directory, keyed by the module's
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
  Scenario: Without VITEST_FS_MODULE_CACHE_DIR the cache lives under XDG_CACHE_HOME
    Given XDG_CACHE_HOME points at an empty directory
    And VITEST_FS_MODULE_CACHE_DIR is not set
    When a checkout runs its tests
    Then its modules are written under vitest/fs-module-cache in that directory

  @integration
  Scenario: Without XDG_CACHE_HOME either the cache lives under ~/.cache
    Given XDG_CACHE_HOME is not set
    And VITEST_FS_MODULE_CACHE_DIR is not set
    When a checkout runs its tests
    Then its modules are written under .cache/vitest/fs-module-cache in the home directory

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

  @integration
  Scenario: A second checkout with a different tsconfig does not reuse the first's entry
    Given the first checkout has run its tests with one tsconfig
    When a second checkout whose tsconfig differs runs the same tests
    Then its modules are transformed again
    And a third checkout with the first checkout's tsconfig reads from the cache

  @integration
  Scenario: A module whose source names the first checkout's path is not reused by the second
    Given a module whose source contains the first checkout's absolute path
    And the first checkout has run its tests
    When the second checkout has the same module and runs its tests
    Then that module is transformed again and the test imports it

  @integration
  Scenario: A module whose source contains the cache's root token is never cached
    Given a module whose source contains the cache's root token
    When two checkouts run their tests
    Then neither run writes that module to the shared cache or reads it from there
    And the module sees the token exactly as its source writes it

  @integration
  Scenario: A module outside the checkout keeps no checkout path in its stored source map
    Given a module outside the workspace root whose source map points into the checkout
    When the checkout runs a test that imports it
    Then the cached module's inline source map does not lead into the checkout
    And the test imports the module

  @integration
  Scenario: The main process loads a cached global setup in its own checkout
    Given two checkouts whose global setup imports a workspace file
    When the first fills the cache and the second reads the global setup from it
    Then each checkout's global setup imports its own workspace file
