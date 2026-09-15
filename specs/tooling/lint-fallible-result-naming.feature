Feature: The fallible-result-naming lint rule
  A method on a strict feature API, app, port, service, repository or store
  answers or throws. No `try` prefix, whatever the return type: a `tryFind`
  hands the caller a maybe where a thrown domain error would have named the
  failure, and the fix is to drop the prefix and throw — renaming it `find*`
  only moves the hedge into the name. Absence as a normal outcome, decided on
  its own merits rather than to escape a `try`, is a `find*` method returning
  undefined, and only a `find*` method may carry a nullable result. No redundant `require`
  prefix, and every method states its result type.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A try-prefixed method is refused whatever its return type
    Given a method named with the try prefix, on a class, an abstract port or an API interface
    When the fallible-result-naming rule runs over it
    Then it reports tryPrefix with the plain rename, whether or not the result is nullable

  @unit
  Scenario: Dropping the try prefix means throwing, not renaming to find
    Given a method named with the try prefix
    When the fallible-result-naming rule runs over it
    Then the fix tells the author to name it without the prefix and make the body throw
    And it says renaming it to find is not the fix

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
