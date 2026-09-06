Feature: The service-classes lint rule
  A strict feature service module exports exactly one class named `*Service`
  with a static `create`; behaviour does not live in a standalone exported
  function or arrow beside it.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A standalone exported function is reported by name
    Given a service module that exports a standalone function beside its Service class
    When the service-classes rule runs over it
    Then it reports standalone naming the function

  @unit
  Scenario: A service module missing its Service class is reported
    Given a service module that defines no class ending in Service
    When the service-classes rule runs over it
    Then it reports missing

  @unit
  Scenario: A service class without static create is reported
    Given a service module whose Service class has no static create method
    When the service-classes rule runs over it
    Then it reports create

  @unit
  Scenario: A well-formed service module is left alone
    Given a service module whose Service class exposes a static create method
    When the service-classes rule runs over it
    Then it reports nothing
