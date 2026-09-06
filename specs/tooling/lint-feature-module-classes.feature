Feature: The feature-module-classes lint rule
  A strict feature port module exports an abstract `*Port` class; a runtime
  module (adapter, repository, store, api, migration, projection) exports a
  concrete class of the matching suffix with a static `create`. Behaviour
  does not live in a standalone exported function beside it.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A concrete class in a port module is reported as needing to be abstract
    Given a port module that exports a concrete class named AgentPort
    When the feature-module-classes rule runs over it
    Then it reports abstract naming the Port suffix

  @unit
  Scenario: An abstract port class is left alone
    Given a port module that exports an abstract class named AgentPort
    When the feature-module-classes rule runs over it
    Then it reports nothing

  @unit
  Scenario: A concrete adapter without static create is reported
    Given an adapter module whose concrete class has no static create method
    When the feature-module-classes rule runs over it
    Then it reports create

  @unit
  Scenario: A standalone function in a strict feature module names its path and suffix
    Given an adapter module that exports a standalone function instead of a class
    When the feature-module-classes rule runs over it
    Then it reports standalone naming the module's path and suffix

  @unit
  Scenario: A well-formed concrete adapter is left alone
    Given an adapter module whose concrete class exposes a static create method
    When the feature-module-classes rule runs over it
    Then it reports nothing
