@tooling @unit
Feature: test:changed runs the tests a change reaches by imports
  `pnpm test:changed [files...]` keeps the repository's import graph in a cache
  file, finds every test file that imports a changed file directly or not, in
  any package, and runs each package's own Vitest with exactly those files
  (ADR-182). With no files named, the change is what differs from the merge
  base with origin/main, uncommitted and untracked files included.

  Scenario: An edit runs the test files that import it, in every package
    Given a source file imported by a test in its own package
    And imported through a workspace package's exports by a test in another package
    When test:changed runs for that file
    Then each package runs its own test script with only its reached test files
    And the edited file's own package runs first

  Scenario: A type-only import does not reach a test
    Given a test file that imports a source file only with `import type`
    When test:changed runs for that source file
    Then that test file is not chosen

  Scenario: Subpath imports and tsconfig paths are followed
    Given a test that imports a file through a `#` subpath import
    And a test that imports a file through a tsconfig `paths` alias
    When test:changed runs for either file
    Then the test that imports it is chosen

  Scenario: A changed Vitest config or setup file runs its whole suite
    Given a package whose vitest config names a setup file
    When the setup file changes
    Then the package's whole suite runs, after the packages that run only reached files

  Scenario: A file a package's tests read from disk is listed, and runs its whole suite on request
    Given a package whose tests read a file outside it, listed in the test reads table
    When that file changes
    Then the package is listed as not run, with the file that matched
    And with --reads, the package's whole suite runs

  Scenario: A test file no Vitest package owns is listed, not run
    Given a reached test file in a directory whose package has no `vitest run` test script
    When test:changed plans the run
    Then the file is listed as not run

  Scenario: The graph rescans only the files that changed since the last run
    Given a graph cache file from an earlier run
    When one source file's contents change
    Then only that file is read again
    And with no change at all, nothing is read or resolved again
