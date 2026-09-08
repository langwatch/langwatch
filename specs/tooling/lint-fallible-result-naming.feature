Feature: The fallible-result-naming lint rule
  A method on a strict feature API, app, port, service, repository or store
  answers or throws. No `try` prefix, whatever the return type: a `tryFind`
  hands the caller a maybe where a thrown domain error would have named the
  failure. Absence as a normal outcome is a `find*` method returning undefined,
  and only a `find*` method may carry a nullable result. No redundant `require`
  prefix, and every method states its result type.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A try-prefixed method is refused whatever its return type
    Given a method named with the try prefix, on a class, an abstract port or an API interface
    When the fallible-result-naming rule runs over it
    Then it reports tryPrefix with the plain rename, whether or not the result is nullable

  @unit
  Scenario: Absence belongs to find methods alone
    Given a method whose result type is nullable
    When the fallible-result-naming rule runs over it
    Then it reports nullableWithoutFind unless the method is named find*
    And a getter that always answers or throws is left alone

  @unit
  Scenario: The require prefix is reported with a rename fix
    Given a port method named with the redundant require prefix
    When the fallible-result-naming rule runs over it
    Then it reports requirePrefix naming the method

  @unit
  Scenario: A missing result type is reported
    Given a port method with no explicit return type
    When the fallible-result-naming rule runs over it
    Then it reports noResultType
    But a method of a class that implements an interface is left alone, since the interface states the type
