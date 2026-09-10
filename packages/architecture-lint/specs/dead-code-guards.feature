Feature: Code nothing reads is refused before it is inherited
  As a maintainer
  I want the whole-graph guards to name code that has quietly stopped being read
  So that a codemod that orphans a file, a fold that carries a dead requirement, or a
  half-written repository twin is reported the day it lands rather than the day it breaks

  Background:
    Given architecture lint reads the whole workspace as one import graph
    And each guard carries a shrink-only baseline of what already offended when it landed
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

    @unit @architecture
    Scenario: A baselined unused export is silent and a stale baseline entry is reported
      Given the unused module export baseline lists a file and a name
      When the export is still unread
      Then no violation is reported for it
      When the export is read or gone
      Then the baseline entry is reported as one that must be removed

  Rule: `infrastructure-member-unused` refuses a boot requirement the module never reaches

    @unit @architecture
    Scenario: An infrastructure member no code in the package reaches is reported
      Given a module declares a member on its `<Feature>Infrastructure` interface
      And no app, service or repository in that package reaches the member
      When architecture lint checks the workspace
      Then it reports the interface and the member
      And the remedy says to delete the member and the collaborator each process builds for it

    @unit @architecture
    Scenario: A member reached by destructuring is a read
      Given a module's app destructures the member off its infrastructure record
      When architecture lint checks the workspace
      Then it reports nothing for that member

    @unit @architecture
    Scenario: A member only a test names is still dead weight
      Given the only file naming the member is a fixture or a test
      When architecture lint checks the workspace
      Then it reports the member, because a fixture proves the shape rather than using it

    @unit @architecture
    Scenario: A baselined infrastructure member is silent and a stale baseline entry is reported
      Given the unused infrastructure member baseline lists an interface and a member
      When the member is still unread
      Then no violation is reported for it
      When the member is read or gone
      Then the baseline entry is reported as one that must be removed

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

    @unit @architecture
    Scenario: A baselined drift is silent and a stale baseline entry is reported
      Given the memory twin drift baseline lists a repository, a side and a method
      When the drift still holds
      Then no violation is reported for it
      When the two sides agree again
      Then the baseline entry is reported as one that must be removed
