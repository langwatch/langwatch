Feature: The transport-imports-a-repository lint rule
  A route holds a request, not a table. Everything a transport declaration
  needs it asks the module app for, and the app is where the guards, the
  tenancy filter and the authorisation decision live. A route that reaches a
  repository has walked round all three, and no reviewer reading the route
  can see that it did.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A route importing from repositories bypasses the app
    Given a transport file that imports from the repositories folder
    When the transport-imports-a-repository rule runs over it
    Then it reports repositoryFolder
    And the message names the specifier

  @unit
  Scenario: A route reaching a repositories folder at any depth bypasses the app
    Given a transport file that imports from a repositories folder several levels up
    When the transport-imports-a-repository rule runs over it
    Then it reports repositoryFolder

  @unit
  Scenario: A route importing a repository module bypasses the app
    Given a transport file that imports a repository module held outside the folder
    When the transport-imports-a-repository rule runs over it
    Then it reports repositoryModule

  @unit
  Scenario: A route holding a repository value bypasses the app
    Given a transport file that imports a value whose name ends in Repository
    When the transport-imports-a-repository rule runs over it
    Then it reports repositoryName

  @unit
  Scenario: A type-only repository name is erased and is allowed
    Given a transport file that imports a Repository type only
    When the transport-imports-a-repository rule runs over it
    Then it reports nothing

  @unit
  Scenario: A route reaching the module app is allowed
    Given a transport file that imports the module app
    When the transport-imports-a-repository rule runs over it
    Then it reports nothing

  @unit
  Scenario: A service importing a repository is not governed
    Given a service file that imports from the repositories folder
    When the transport-imports-a-repository rule runs over it
    Then it reports nothing

  @unit
  Scenario: A transport test building a repository fixture is not governed
    Given a transport test file that imports a memory repository
    When the transport-imports-a-repository rule runs over it
    Then it reports nothing
