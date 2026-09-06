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
    But a package held on 6 may, because there the root export is the compiler

  @unit
  Scenario: Every workspace package builds against one compiler major
    Given the workspace installs from a single root
    Then every package declares TypeScript 7
    But the packages that drive the old programmatic compiler API stay on 6
    # Two of them publish bundled declarations through tsup's `dts: true`; the
    # third is the architecture linter, a synchronous CLI over the whole tree
    # that uses a program, a printer and a scanner 7 does not expose. Held
    # deliberately, not by omission.

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
  Scenario: Every package tsconfig extends the shared root base
    Given the workspace declares one root tsconfig with the compiler options every package shares
    When a package's own tsconfig.json is read
    Then its "extends" field points at the shared root base
    And the package layers only its own paths and overrides on top

  @unit
  Scenario: Every package sets incremental with its own build info file
    Given a package tsconfig extends the shared root base
    When the package is typechecked
    Then its tsconfig declares "incremental": true
    And its "tsBuildInfoFile" is scoped to that package under node_modules/.cache/tsbuildinfo
    # A shared or missing path lets packages clobber each other's cache, or
    # forces every typecheck to start cold.

  @unit
  Scenario: Checking one package does not invalidate another's cache
    Given two packages each declare their own tsBuildInfoFile
    When one package is typechecked
    Then the other package's cached build info file is untouched
    And that other package's next typecheck starts warm, not cold
