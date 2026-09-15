Feature: The fallible-result-naming lint rule
  A method on a strict feature API, app, port, service, repository or store
  answers or throws. A `try`-prefixed method whose own body catches a failure
  and hands the caller null or undefined instead is refused, and the fix is to
  delete that catch and drop the prefix — renaming it `find*` only moves the
  hedge into the name. A `try`-prefixed declaration with no such catch — an
  interface signature, an abstract method, or a body that never converts a
  failure into an absence — carries a naming defect too, but that defect
  belongs to a separate rule (`langwatch/no-try-prefix`) whose message does
  not claim a catch it cannot see; this rule falls through to whichever of its
  own checks already applies to that name, except one: a nullable `try`-prefixed
  name is exempt from nullableWithoutFind here, since no-try-prefix already
  prescribes the same `find<Noun>` rename for it, and reporting both would be
  one defect stated twice. Absence as a normal outcome, decided on its own
  merits rather than to escape a `try`, is a `find*` method returning
  undefined, and only a `find*` method may carry a nullable result. No
  redundant `require` prefix, and every method states its result type.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A try-prefixed method with a swallowing catch is refused
    Given a try-prefixed method whose body catches a failure and returns null, undefined, or nothing, or whose promise chain ends in a `.catch(() => null)`
    When the fallible-result-naming rule runs over it
    Then it reports tryPrefix with the plain rename, whatever the declared return type

  @unit
  Scenario: A try-prefixed declaration with no catch is not accused of one
    Given a try-prefixed declaration that has no body, or a body with no catch, or a catch that rethrows
    When the fallible-result-naming rule runs over it
    Then it does not report tryPrefix
    And it falls through to noResultType when that already applies to the name

  @unit
  Scenario: Dropping the try prefix means throwing, not renaming to find
    Given a try-prefixed method whose catch swallows the failure
    When the fallible-result-naming rule runs over it
    Then the fix tells the author to name it without the prefix and make the body throw
    And it says renaming it to find is not the fix

  @unit
  Scenario: Absence belongs to find methods alone
    Given a method whose result type is nullable and is not named try*
    When the fallible-result-naming rule runs over it
    Then it reports nullableWithoutFind unless the method is named find*
    And a getter that always answers or throws is left alone

  @unit
  Scenario: A nullable try-prefixed method reports the rename once, not twice
    Given a try-prefixed method whose result type is nullable, whether or not its body swallows a failure
    When both the fallible-result-naming and no-try-prefix rules run over it
    Then fallible-result-naming does not report nullableWithoutFind for it
    And no-try-prefix reports noTryPrefix for the same method, so the rename is prescribed exactly once

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
