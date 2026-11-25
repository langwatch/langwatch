Feature: The unresolved-relative-import lint rule
  A move leaves every relative specifier that named the old path behind: the
  compiler reads a stale declaration file and stays green, the editor
  resolves through the same declaration, and the first honest answer comes
  from a test run. The rule resolves every relative specifier against the
  disk - static imports, re-exports, dynamic imports and require calls.

  @unit
  Scenario: A re-export of a moved file is unresolved
    Given a barrel file that re-exports and star-exports paths no file answers to
    When the unresolved-relative-import rule runs over it
    Then it reports unresolved on each re-export's line, naming the specifier

  @unit
  Scenario: A static import of a moved file is unresolved
    Given a source file that imports a path no file answers to
    When the unresolved-relative-import rule runs over it
    Then it reports unresolved

  @unit
  Scenario: A dynamic import of a moved file is unresolved
    Given a source file whose import() names a path no file answers to
    When the unresolved-relative-import rule runs over it
    Then it reports unresolved on the import expression's line

  @unit
  Scenario: A require of a moved file is unresolved
    Given a source file whose require() names a path no file answers to
    When the unresolved-relative-import rule runs over it
    Then it reports unresolved

  @unit
  Scenario: A specifier that resolves on disk is allowed
    Given a source file whose relative specifiers name existing files, folders with an index, compiled .js names or assets
    When the unresolved-relative-import rule runs over it
    Then it reports nothing

  @unit
  Scenario: A package specifier, a computed specifier or a build-tool suffix is not resolved
    Given a source file importing a package, a computed path, or a path with a build-tool suffix
    When the unresolved-relative-import rule runs over it
    Then it reports nothing
