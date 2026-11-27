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

  Scenario: A lint run whose every path is ignored has no problems
    Given oxlint is given only paths its ignore patterns exclude
    When it prints "No files found to lint." and exits 1
    Then the lint run reports 0 problems and passes
    And output that is neither that line nor a JSON report still fails the run
  Scenario: A type-aware scope past half the projects lints every project
    Given a change that reaches more than half of the TypeScript projects
    When lint:types runs with --base
    Then oxlint is given every TypeScript project
    And a change that reaches half of them or fewer is given only those

  Scenario: A project's typecheck replays unless its own files or its dependencies' declarations changed
    Given every TypeScript project's typecheck target
    Then it is cached and runs after its dependencies' typecheck
    And it hashes its own files and the declarations its dependencies' tasks emitted, never their sources
    And it declares the declarations it writes as outputs, never a whole dist directory

  Scenario: A change that keeps a package's declarations replays its dependants
    Given a change to a function body in a package other packages depend on
    When pnpm typecheck runs
    Then that package's typecheck runs
    And its dependants' typecheck replays from the cache, because the declarations they hash are unchanged

  Scenario: A typecheck hashes the configs it extends and the sources of dependencies with no declarations
    Given a project whose tsconfig extends a config outside the project
    And a dependency that publishes no declarations, so tsc reads its sources
    Then the extended config is part of the project's typecheck hash
    And so are the production files of that dependency, and of such dependencies further down
    But a dependency's devDependencies are not

  Scenario: Generated sources and built declarations exist before a project's typecheck
    Given a project whose sources import a generated file, or whose published types its build writes
    Then its typecheck runs that generator or that build first
    And the files they write are part of its hash

  Scenario: The source typecheck and the plain lint replay from the cache
    Given the workspace project's typecheck:src and lint:tree targets
    Then both are cached
    And typecheck:src hashes the sources of every file tsc reads, never the contents of a dist directory

  Scenario: Lint runs replay through Nx except a lint of the working tree
    Given a lint run with --changed
    Then it lints the working tree's changes itself
    And a full or --base plain run resolves its scope and lints it through the cached Nx target
    And the target's run lints only the paths it was given, dropping the flags and the --base value

  Scenario: Type-aware lint batches the projects Nx did not replay
    Given a full or --base lint:types run
    Then every TypeScript project's typecheck runs or replays first, so the declarations it reads are built from hashed sources
    And every TypeScript project's lint:types is cached on its own files and its dependencies' sources, whatever the --base value
    And the lint runner and its executor are lint globals, so a change to either relints every project
    And the projects Nx did not replay are linted in one oxlint run, each failing only on findings in its own files
    And an oxlint process that could not run fails every project in the run
    And the plain lint does not wait for typecheck

  Scenario: Build info written outside dist is a typecheck output
    Given a TypeScript config whose build info lives outside its dist directory
    Then the typecheck target declares that build info file as an output
