Feature: A module's runtime code does not import a devDependency
  As a maintainer
  I want a module's contract and process production code to import only packages its manifest ships
  So that the packed artifact boots instead of crashing with ERR_MODULE_NOT_FOUND

  The packed-artifact smoke boot crashed because a process rules file imported a contract package
  its package.json listed only in devDependencies. A package installed from the artifact has no
  devDependencies. See dev/docs/plans/platform-architecture-blocks.md (Alex, 2026-10-20). A fix
  rule: main runs at zero and the policy blocks in CI. Browser code is bundled and out of scope.

  Rule: `runtime-dev-dependency` refuses a value import of a package listed only in devDependencies

    @unit @architecture
    Scenario: A value import of a dev-only package in process code is reported
      Given a process package lists a package only in devDependencies
      And a production file in its src imports a value from that package
      When the runtime-dev-dependency policy reads the tree
      Then it reports the file, the package and the remedy to move it to dependencies

    @unit @architecture
    Scenario: A re-export and a dynamic import of a dev-only package are reported
      Given a contract package lists a package only in devDependencies
      And a production file re-exports from it and another imports it dynamically
      When the runtime-dev-dependency policy reads the tree
      Then it reports both uses

    @unit @architecture
    Scenario: A package listed in dependencies or peerDependencies passes
      Given a process package lists one package in dependencies and another in peerDependencies
      And a production file imports a value from each
      When the runtime-dev-dependency policy reads the tree
      Then it reports nothing

    @unit @architecture
    Scenario: A type-only import of a dev-only package passes
      Given a process package lists a package only in devDependencies
      And a production file imports it with import type and re-exports it with export type
      When the runtime-dev-dependency policy reads the tree
      Then it reports nothing

    @unit @architecture
    Scenario: An import of inline type specifiers still loads a dev-only package
      Given a process package lists a package only in devDependencies
      And a production file imports it with inline type specifiers only
      When the runtime-dev-dependency policy reads the tree
      Then it reports the import, because verbatimModuleSyntax keeps it as import {} from

    @unit @architecture
    Scenario: Tests, testing helpers and declaration files are skipped
      Given a process package lists a package only in devDependencies
      And that package is imported from a test file, a testing.ts helper, a fixtures file and a declaration file
      When the runtime-dev-dependency policy reads the tree
      Then it reports nothing

    @unit @architecture
    Scenario: Browser packages are out of scope
      Given a browser package lists a package only in devDependencies
      And a production file in its src imports a value from that package
      When the runtime-dev-dependency policy reads the tree
      Then it reports nothing

    @unit @architecture
    Scenario: The real tree holds no such import
      Given the repository's modules and enterprise modules
      When the runtime-dev-dependency policy reads the tree
      Then it reports nothing
