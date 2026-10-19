Feature: One external package is one version across the workspace
  As a maintainer of the monorepo
  I want every workspace member to take a shared dependency from the pnpm catalog
  So that the UI bundle and the install carry one copy of each package

  Background:
    Given architecture lint reads every workspace member named by the packages globs in pnpm-workspace.yaml
    And it reads dependencies, devDependencies and optionalDependencies, never peerDependencies
    And the messages it emits are written as the instruction the author should have followed

  Rule: `dependency-catalog` refuses a shared dependency that does not come from the catalog

    @unit @architecture
    Scenario: A dependency the catalog names is written with an explicit range
      Given the default catalog names a package
      And a workspace member declares that package with its own range
      When architecture lint checks the workspace
      Then it reports the manifest and the line of the declaration
      And the remedy tells the author to write "catalog:"

    @unit @architecture
    Scenario: A dependency a named catalog names is written with an explicit range
      Given a named catalog names a package
      And a workspace member declares that package with its own range
      When architecture lint checks the workspace
      Then it reports the declaration, because a named catalog pins the version too

    @unit @architecture
    Scenario: A dependency two members declare is not in the catalog
      Given two workspace members declare one external package
      And the catalog does not name it
      When architecture lint checks the workspace
      Then it reports both manifests
      And the remedy tells the author to add the package to the catalog in pnpm-workspace.yaml

    @unit @architecture
    Scenario: A dependency only one member declares is left alone
      Given one workspace member declares an external package nobody else declares
      When architecture lint checks the workspace
      Then it reports nothing

    @unit @architecture
    Scenario: A workspace, file or link dependency is not an external package
      Given two workspace members declare one package with workspace:, file: or link: ranges
      When architecture lint checks the workspace
      Then it reports nothing

    @unit @architecture
    Scenario: A peer range is stated on purpose
      Given two workspace members declare one package as a peer dependency
      When architecture lint checks the workspace
      Then it reports nothing

    @unit @architecture
    Scenario: A member that takes every shared dependency from the catalog is silent
      Given every shared dependency is written as "catalog:" or "catalog:<name>"
      When architecture lint checks the workspace
      Then it reports nothing
