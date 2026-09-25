Feature: The no-inline-dynamic-import lint rule
  An inline `import(...)` hides a dependency the reader expects to find at the
  top of the file. The places where loading late is the point are exempt: the
  CLI and MCP server startup paths, the Google DLP channel, a web package's top-level entry files, the
  UI application's routes and drawers, a component code-split through
  `lazy(() => import(...))`, and test files, where an import that follows
  `vi.mock` is what makes the mock apply.

  @unit
  Scenario: An inline dynamic import in governed source is a failure
    Given a process service that awaits an inline import()
    When the no-inline-dynamic-import rule runs over it
    Then it reports inlineDynamicImport

  @unit
  Scenario: A top-level import statement is allowed
    Given a process service with a top-level import statement
    When the no-inline-dynamic-import rule runs over it
    Then it reports nothing

  @unit
  Scenario: The CLI startup path is exempt
    Given a file under sdks/typescript/src/cli with an inline import()
    When the no-inline-dynamic-import rule runs over it
    Then it reports nothing

  @unit
  Scenario: The Google DLP channel is exempt
    Given the data-privacy Google DLP channel with an inline import()
    When the no-inline-dynamic-import rule runs over it
    Then it reports nothing, while a sibling channel is still reported

  @unit
  Scenario: The CLI tsup config is exempt
    Given sdks/typescript/tsup.config.ts with an inline import()
    When the no-inline-dynamic-import rule runs over it
    Then it reports nothing

  @unit
  Scenario: A web package top-level entry file is exempt
    Given a browser package's top-level entry file with an inline import()
    When the no-inline-dynamic-import rule runs over it
    Then it reports nothing

  @unit
  Scenario: A nested web package file is not exempt
    Given a file nested inside a browser package's ui folder with an inline import()
    When the no-inline-dynamic-import rule runs over it
    Then it reports inlineDynamicImport

  @unit
  Scenario: The UI application is exempt for route and drawer lazies
    Given a file under apps/ui/src with an inline import()
    When the no-inline-dynamic-import rule runs over it
    Then it reports nothing

  @unit
  Scenario: A lazy-loaded component is allowed
    Given a nested browser file loading components through lazy and React.lazy, one through a .then
    When the no-inline-dynamic-import rule runs over it
    Then it reports nothing

  @unit
  Scenario: An import inside a non-lazy callback is still reported
    Given a nested browser file whose import() sits in a callback passed to anything but lazy
    When the no-inline-dynamic-import rule runs over it
    Then it reports inlineDynamicImport on the import's line

  @unit
  Scenario: A test file may import after its mocks
    Given a unit test that imports the module under test after vi.mock
    When the no-inline-dynamic-import rule runs over it
    Then it reports nothing
