Feature: The dangling-barrel-export lint rule
  A codemod moves a file, the barrel keeps pointing at the path it left, and
  nothing says so: the compiler reads a stale declaration file and stays
  green, the editor resolves through the same declaration, and the first
  honest answer comes from a test run. Resolving the specifier against the
  disk is the one check a build artefact cannot fool.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A re-export of a moved file is dangling
    Given a barrel file that re-exports a path no file answers to
    When the dangling-barrel-export rule runs over it
    Then it reports danglingReexport
    And the message names the specifier

  @unit
  Scenario: A star re-export of a deleted folder is dangling
    Given a barrel file that star-exports a path no file answers to
    When the dangling-barrel-export rule runs over it
    Then it reports danglingReexport

  @unit
  Scenario: A re-export that resolves on disk is allowed
    Given a barrel file that re-exports a file which exists
    When the dangling-barrel-export rule runs over it
    Then it reports nothing

  @unit
  Scenario: A re-export of a folder with an index file is allowed
    Given a barrel file that star-exports a folder holding an index file
    When the dangling-barrel-export rule runs over it
    Then it reports nothing

  @unit
  Scenario: An import of a moved file is dangling
    Given a source file that imports a path no file answers to
    When the dangling-barrel-export rule runs over it
    Then it reports danglingImport

  @unit
  Scenario: An import written with a .js extension resolves to the .ts file
    Given a source file that imports the compiled name of a TypeScript file
    When the dangling-barrel-export rule runs over it
    Then it reports nothing

  @unit
  Scenario: An import of a non-source file that exists is allowed
    Given a source file that imports a stylesheet by its exact path
    When the dangling-barrel-export rule runs over it
    Then it reports nothing

  @unit
  Scenario: A package specifier is never resolved against the disk
    Given a source file that imports a package specifier
    When the dangling-barrel-export rule runs over it
    Then it reports nothing

  @unit
  Scenario: A specifier carrying a build-tool suffix is not resolved
    Given a source file that imports through a build-tool suffix
    When the dangling-barrel-export rule runs over it
    Then it reports nothing
