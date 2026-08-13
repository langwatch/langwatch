Feature: A test mock cannot name a module that does not exist
  As a developer replacing a module in a test
  I want a mock that names nothing to fail the build
  So that a suite can never go green while asserting against the module it meant to replace

  # `vi.mock("<specifier>")` does not fail when the specifier resolves to no
  # file. Vitest registers a mock under a module id nothing ever requests, the
  # real module loads instead, and every assertion in the file is then made
  # against the thing the test set out to replace. The common way in is a path
  # copied out of the module under test into its `__tests__/` subdirectory,
  # which is off by exactly one directory level, and a mock target that was
  # deleted while its mock stayed behind.

  Rule: every mock names a module that exists

    @unit
    Scenario: A mock naming a module that exists passes the check
      Given a test file mocking a module beside it
      When the mock check runs over it
      Then the file passes the check

    @unit
    Scenario: A mock naming no module at all fails the check
      Given a test file mocking a path that is one directory level off
      When the mock check runs over it
      Then the file fails the check, naming the specifier and the line

    @unit
    Scenario: A mock naming an installed package is left to node
      Given a test file mocking a package by name
      When the mock check runs over it
      Then the file passes the check, because node resolves the package rather than a path

    @unit
    Scenario: A mock written in the typed import form is still checked
      Given a test file naming its module through an import call rather than a bare string
      When the mock check runs over it
      Then the module named inside the import call is the one checked

    @unit
    Scenario: A mock written the NodeNext way resolves to its TypeScript source
      Given a test file mocking a path that ends in the emitted javascript extension
      When the mock check runs over it
      Then the TypeScript source that emits it counts as the module

    @unit
    Scenario: A specifier named only in a comment is not a call site
      Given a test file mentioning a mock in a comment or a string
      When the mock check runs over it
      Then nothing is reported, because no mock was called

    @unit
    Scenario: A mock written with doMock is checked like any other
      Given a test file whose only mock call is written with doMock
      When the mock check runs over it
      Then the file is still examined
      And a specifier naming nothing is reported

  Rule: the check resolves the way the test runner does

    @unit
    Scenario: The check reads the alias table from the vitest configs
      Given the vitest configs declaring the aliases test files may use
      When the mock check builds its resolver
      Then it expands each alias against the directory of the config declaring it
      And an alias entry it cannot read fails loudly instead of being dropped

    @unit
    Scenario: An alias path expands the way the config's own call does
      Given one config building an alias path with join and another with resolve
      When the mock check reads those tables
      Then each path expands the way that call expands it
      And an absolute segment is treated as that call treats it

    @unit
    Scenario: Overlapping aliases keep the order the config declares
      Given a config declaring two aliases that both claim the same specifier
      When the mock check resolves that specifier
      Then it takes the alias declared first, the way the test runner does
      And not the longest or most specific one
