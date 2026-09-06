Feature: TypeScript 7 is the compiler

  The repo typechecks with the native compiler. It did so as a pinned preview
  build for months; TypeScript 7 is released, so `tsc` IS the native compiler
  and the preview package is gone.

  What changes for anyone writing code is narrow but sharp: the compiler API is
  no longer importable from `typescript`, because the root export is a version
  constant. Reaching for `ts.createSourceFile` there fails at runtime, not at
  the type level, so a static scan that still does it goes quiet rather than
  red — it finds nothing and reports clean.

  ADR: dev/docs/adr/099-typescript-7-is-the-compiler.md

  @unit
  Scenario: The compiler API is only reached through its unstable export
    Given a file that needs a TypeScript AST
    When it imports the compiler
    Then it takes the AST types and predicates from the unstable export
    And no file value-imports the root `typescript` module

  @unit
  Scenario: Every workspace package builds against one compiler major
    Given the workspace installs from a single root
    Then every package declares TypeScript 7
    But the two packages that publish bundled declarations stay on 6
    # tsup's `dts: true` bundles through the old programmatic compiler API,
    # which 7 does not expose. Held deliberately, not by omission.

  @unit
  Scenario: The superseded preview compiler is gone
    Given TypeScript 7 is released
    Then no package declares `@typescript/native-preview`

  @unit
  Scenario: Source text with no file behind it still parses
    Given a snippet that exists only as a string
    When a scan asks for its parsed form
    Then it gets back a syntax tree of that text
    And the scan walks it without the snippet ever reaching disk

  @unit
  Scenario: A name reused with new text parses the new text
    Given a snippet was parsed under some file name
    When different text is parsed under that same name
    Then the second parse reflects the second text
    # The session caches source files by path, so a scan pinning a rule across
    # several snippets would otherwise judge every one of them by the first.

  @unit
  Scenario: The whole repository is typechecked as one program
    Given every test file imports the application code it tests
    When a contributor typechecks everything
    Then the application files are checked once, not once for each project
    # Two projects run back to back checked the app's files twice, which cost
    # 35.1M type instantiations against 18.9M for the single program.

  @unit
  Scenario: The combined project checks every file the split projects checked
    Given an application project and a tests project that each cover part of the repository
    When one project replaces both
    Then no file that was checked before is left unchecked

  @unit
  Scenario: Checking one project does not cool another
    Given a contributor checks more than one of the projects
    Then each keeps what it learned
    And no run makes another start from cold again
