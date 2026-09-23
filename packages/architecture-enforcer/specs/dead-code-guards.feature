Feature: Code nothing reads is refused before it is inherited
  As a maintainer
  I want the whole-graph guards to name code that has quietly stopped being read
  So that a codemod that orphans a file, a fold that carries a dead requirement, or a
  half-written repository twin is reported the day it lands rather than the day it breaks

  Background:
    Given architecture lint reads the whole workspace as one import graph
    And every finding a guard makes is reported; no file exempts one
    And the messages it emits are written as the instruction the author should have followed

  Rule: `unused-module-export` refuses an export no file in the repository imports

    @unit @architecture
    Scenario: An export nothing imports is reported against the file that declares it
      Given a module server file exports a name
      And no file anywhere in the repository imports that name
      When architecture lint checks the workspace
      Then it reports the file and the name
      And the remedy says to delete the export or publish it from the package index

    @unit @architecture
    Scenario: A name the package index re-exports is part of the public surface
      Given a module server file exports a name
      And the package index re-exports it
      When architecture lint checks the workspace
      Then it reports nothing, because whether anything composes the published name is another guard's question

    @unit @architecture
    Scenario: A namespace import names no member, so it reads the whole module
      Given a file imports a module server file as a namespace
      When architecture lint checks the workspace
      Then it reports none of that module's exports

    @unit @architecture
    Scenario: A test file's own exports are not checked
      Given a test, a fixture or a testing entry exports a name nothing imports
      When architecture lint checks the workspace
      Then it reports nothing for that file

  Rule: `memory-twin-drift` refuses a twin whose method set differs from its Prisma sibling

    @unit @architecture
    Scenario: A method the memory twin lacks is reported against the twin
      Given a Prisma repository and its memory twin implement the same repository
      And the Prisma repository declares a method the twin does not
      When architecture lint checks the workspace
      Then it reports the twin, the repository and the method
      And the remedy says to implement it on the twin or delete it from the Prisma repository

    @unit @architecture
    Scenario: A method only the memory twin declares is reported against the Prisma repository
      Given the memory twin declares a method the Prisma repository does not
      When architecture lint checks the workspace
      Then it reports the Prisma repository, because a method only the twin carries passes every suite and is missing in production

    @unit @architecture
    Scenario: Twins that carry the same methods report nothing
      Given a Prisma repository and its memory twin declare the same methods
      When architecture lint checks the workspace
      Then it reports nothing for that repository
