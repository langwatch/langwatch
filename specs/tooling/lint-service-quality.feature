Feature: The service-quality lint rule
  A strict feature service module cannot declare the same class member or
  object-literal key twice, and a class exposing a static `create` factory
  must keep its constructor private so callers cannot bypass the factory.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A static and an instance member of the same name do not collide
    Given a service class with a static method and an instance method sharing a name
    When the service-quality rule runs over it
    Then it reports nothing

  @unit
  Scenario: A duplicate object literal key is reported by name
    Given a service module with an object literal that repeats a key
    When the service-quality rule runs over it
    Then it reports duplicateObjectKey naming the key

  @unit
  Scenario: A public constructor beside static create is reported by class name
    Given a Service class with a static create factory and a public constructor
    When the service-quality rule runs over it
    Then it reports publicConstructor naming the class
    And the message tells the reader to mark the constructor private

  @unit
  Scenario: A private constructor beside static create is left alone
    Given a Service class with a static create factory and a private constructor
    When the service-quality rule runs over it
    Then it reports nothing
