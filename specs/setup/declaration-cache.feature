@setup @typescript
Feature: Reuse declaration builds across worktrees
  Application checks need fresh declarations without rebuilding unchanged packages
  in every worktree of the same repository.

  Scenario: Another worktree restores a successful declaration build
    Given two worktrees have identical declaration build inputs
    When the first worktree builds declarations successfully
    And the second worktree refreshes its declarations
    Then the second worktree copies the cached declarations into its local dist
    And it does not restore TypeScript build-info files
    And a consumer typechecks using the restored declarations

  Scenario: A dependency changes in only one worktree
    Given two worktrees have reused the same declaration build
    When a dependency source changes in one worktree
    Then that dependency and its consumers are rebuilt for that worktree
    And the other worktree's declarations remain unchanged

  Scenario: A changed consumer uses a restored dependency
    Given a dependency was restored without build-info files
    When only its consumer source changes
    Then only the consumer is compiled

  Scenario: A compilation fails
    When an adopted declaration project has a type error
    Then the declaration command returns the compiler failure
    And the failed build is not cached
    And dependent projects are not compiled

  Scenario: Cached artifacts are incomplete or corrupt
    Given a cached artifact or its manifest does not match its checksum
    When declarations are refreshed
    Then the project is compiled instead of restoring that entry

  Scenario: Two worktrees publish the same build concurrently
    When two worktrees successfully build identical declaration inputs
    Then readers can see only complete cache entries
    And each worktree keeps independent local declaration files

  Scenario: Public declarations re-export JSON
    Given a producer re-exports a JSON value through its public contract
    When declarations are built or restored from another worktree's cache
    Then the consumer typechecks with library checking enabled
    And the referenced JSON exists alongside the declarations
    And cleaning declaration outputs preserves unrelated runtime files

  Scenario: Coupled packages share one checked declaration project
    Given workspace packages have cyclic source imports
    When their declaration group builds successfully
    Then each package receives declarations in its own dist directory
    And declaration maps resolve to that worktree's source files
    And a consumer uses the declarations with library checking enabled
    And cached group output is distributed before dependent checks start

  Scenario: Group JSON outputs change
    Given a group previously emitted several JSON inputs
    When one JSON input is removed and the group is rebuilt
    Then only the obsolete owned JSON is removed from the package output
    And unrelated runtime JavaScript and JSON remain unchanged

  Scenario: An application prepares only its declaration dependencies
    Given an application solution references its adopted dependency projects
    And an unrelated declaration project has a type error
    When declarations are prepared using that application solution
    Then its dependency projects and their explicit references are prepared in dependency order
    And the unrelated project is not compiled
    And changing a required dependency rebuilds its consumers

  Scenario: An application web group reuses the full solution cache
    Given an application solution references a declaration group
    When declarations are prepared using that application solution
    Then the entire group is checked and distributed
    And a later full solution build reuses the same group cache entry

  Scenario: A package checks current source against dependency declarations
    Given the package has stale declarations from an earlier version of its source
    And its dependency has valid checked declarations
    When the package checks its source and tests using its normal TypeScript config
    Then private aliases and public self-imports use the current package source
    And dependency imports use the dependency declarations
    And errors in current package source are reported

  Scenario: A single-package command preserves declaration preparation
    When a contributor selects a package by name or directory with typecheck:one
    Then the package's own typecheck script runs with its declaration prerequisites
    And compiler arguments and the package failure status are preserved
