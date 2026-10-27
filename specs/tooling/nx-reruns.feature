@tooling @unit
Feature: test:affected and lint:changed rerun only what an edit can change
  Nx caches test results by their inputs and lint:changed lints a change (ADR-150).
  An edit that cannot change a verdict must not cost a rerun.

  Scenario: A repo-scanning suite runs uncached, outside the cached test target
    Given a package whose tests walk the whole source tree for a forbidden pattern
    When a source file anywhere outside that package changes
    Then the package's test cache key is unchanged
    And the walking suites run every time as the uncached test:repo target

  Scenario: Tests and Markdown are not part of a package's production input
    Given a package another package depends on
    When a file under its __tests__ directory or a Markdown file in it changes
    Then the dependants' test and build cache keys are unchanged

  Scenario: A plain lint:changed lints the changed files, not their dependants
    Given one changed source file in a shared package
    When lint:changed runs without --types
    Then oxlint is given that file and no other

  Scenario: A changed lint global relints the whole tree
    Given a change to an oxlint configuration or the module catalogue
    When lint:changed runs without --types
    Then oxlint is given the whole tree

  Scenario: A change whose lintable files are all ignored passes
    Given a change whose only lintable files match an ignore pattern
    When lint:changed runs without --types
    Then oxlint reports that it found no files
    And the run passes with no problems
