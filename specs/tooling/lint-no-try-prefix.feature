Feature: The no-try-prefix lint rule
  A method or function named `try<Noun>` is named for how it behaves on
  failure, not for what it answers — whether or not its body actually
  swallows anything. Only 3.8% of this repository's `try*`-named methods
  contain a catch that turns a failure into an absence, so this rule's
  message never claims one exists: it names the naming defect and the one
  condition that decides the rename. If the thing genuinely answers with
  absence and its callers branch on that, it becomes `find<Noun>`. Otherwise
  it drops the prefix and answers or throws. A private method's name is not
  part of its callers' contract, so it is left alone.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A try-prefixed name is refused without claiming a catch
    Given a method or function named with the try prefix, on a class, an abstract port, an interface, or as a free function, whatever its body
    When the no-try-prefix rule runs over it
    Then it reports noTryPrefix naming the method

  @unit
  Scenario: The message never claims a catch exists
    Given a try-prefixed method whose body has no catch at all
    When the no-try-prefix rule runs over it
    Then the message names the naming defect and the condition that picks find<Noun> or dropping the prefix
    And it never mentions a catch

  @unit
  Scenario: A private try-prefixed method is left alone
    Given a private method named with the try prefix
    When the no-try-prefix rule runs over it
    Then it reports nothing, since a private name is not part of any caller's contract

  @unit
  Scenario: A method named without the try prefix is left alone
    Given a method named find<Noun>
    When the no-try-prefix rule runs over it
    Then it reports nothing
