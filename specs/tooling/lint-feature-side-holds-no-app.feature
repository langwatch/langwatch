Feature: The feature-side-holds-no-app lint rule
  The process side installs, mounts and composes modules; it never grows its
  own app. A class under apps/api/src/features, apps/worker/src/app or
  apps/tasks/src that implements or extends a contract *Api type, or that is
  named like one of the module shapes (*Api, *App, *Delegate, Extended*), is
  the module's app hiding in the wrong package. The message names the module
  app as the home for that class.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A class implementing a contract Api type is the module's app
    Given a process-side feature file with a class that implements a contract Api type
    When the feature-side-holds-no-app rule runs over it
    Then it reports implementsApi
    And the message names the contract type the class implements

  @unit
  Scenario: A class extending a contract Api type is the module's app
    Given a process-side feature file with a class that extends a contract Api type
    When the feature-side-holds-no-app rule runs over it
    Then it reports implementsApi

  @unit
  Scenario: A class named *App is the module's app
    Given a process-side feature file with a class named AgentApp
    When the feature-side-holds-no-app rule runs over it
    Then it reports reservedName
    And the message names the class

  @unit
  Scenario: A class named Extended* is the module's app
    Given a process-side feature file with a class named ExtendedAgent
    When the feature-side-holds-no-app rule runs over it
    Then it reports reservedName

  @unit
  Scenario: An ordinary installer class is not the module's app
    Given a process-side feature file with a class named AgentComposition
    When the feature-side-holds-no-app rule runs over it
    Then it reports nothing

  @unit
  Scenario: A test file may define an *App class
    Given a __tests__ file with a class named AgentApp
    When the feature-side-holds-no-app rule runs over it
    Then it reports nothing
