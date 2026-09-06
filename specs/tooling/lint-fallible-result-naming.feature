Feature: The fallible-result-naming lint rule
  A method on a strict feature port, service, repository or store names its
  absence contract: no redundant `require` prefix, an explicit result type,
  a `try` prefix when the type is nullable, and no `try` prefix when it is
  never nullable.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

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

  @unit
  Scenario: An untried absence is reported with the try-prefixed rename
    Given a port method whose return type is nullable but is not try-prefixed
    When the fallible-result-naming rule runs over it
    Then it reports untriedAbsence with the try-prefixed rename

  @unit
  Scenario: A try-prefixed method that cannot be absent is reported
    Given a try-prefixed port method whose return type is never nullable
    When the fallible-result-naming rule runs over it
    Then it reports tryWithoutAbsence

  @unit
  Scenario: A well-formed try method is left alone
    Given a try-prefixed port method whose return type is nullable
    When the fallible-result-naming rule runs over it
    Then it reports nothing
