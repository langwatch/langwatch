Feature: Every policy reads the workspace through the one reading the run already made
  As a maintainer of the architecture linter
  I want each policy to walk, parse and resolve through the shared workspace seams
  So that one file is one syntax tree, one directory is one walk, and one root is one
  resolver, however many policies ask about them

  Background:
    Given architecture lint builds one workspace snapshot per run
    And that snapshot carries a memoised file listing, a parse cache and one module resolver
    And the messages it emits are written as the instruction the author should have followed

  Rule: `workspace-seams` refuses a policy that reads the tree for itself

    @unit @architecture
    Scenario: A policy that parses with the compiler API directly is reported
      Given an architecture policy calls the compiler's own createSourceFile
      When architecture lint checks the workspace
      Then it reports the policy file and the line that calls it
      And the remedy names the shared parse cache as where a syntax tree comes from

    @unit @architecture
    Scenario: A policy that walks the tree for itself is reported
      Given an architecture policy imports the raw directory walk
      When architecture lint checks the workspace
      Then it reports the policy file and the line that binds it
      And the remedy names the memoised listing as where a file list comes from

    @unit @architecture
    Scenario: A policy that builds its own module resolver is reported
      Given an architecture policy imports the module resolver constructor
      When architecture lint checks the workspace
      Then it reports the policy file and the line that binds it
      And the remedy names the snapshot's resolver as the one resolver for the root

    @unit @architecture
    Scenario: An alias is the same reach, so it is reported where the name is bound
      Given an architecture policy imports the raw directory walk under another name
      When architecture lint checks the workspace
      Then it reports the import, because renaming a seam does not make it a different one

    @unit @architecture
    Scenario: A policy reading through the shared seams is silent
      Given an architecture policy parses through the shared cache and lists through the snapshot
      When architecture lint checks the workspace
      Then it reports nothing, because the reading it used is the one the run already made
