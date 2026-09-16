Feature: The no-try-prefix lint rule
  A method or function named `try<Noun>` is named for how it behaves on
  failure, not for what it answers — whether or not its body actually
  swallows anything. Only 3.8% of this repository's `try*`-named methods
  contain a catch that turns a failure into an absence, so this rule's
  message never claims one exists: it names the naming defect and the one
  condition that decides the rename. The prefix goes either way; what it
  becomes depends on what it answers. One thing that may not exist becomes
  `get<Noun>` or `getBy<Key>` and throws rather than answering null. None or
  many becomes an array named `find<Noun>`, whose empty case is the absence.
  What the message must never prescribe is a `find*` that still answers null:
  that was its advice until 2026-09-16, it contradicts the naming decision of
  the same day, and a rename wave took it literally. A private method's name is
  not part of its callers' contract, so it is left alone.

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
    Then the message names the naming defect and the condition that picks the rename
    And it never mentions a catch
    And it names get or getBy with throwing for one thing, and an array named find<Noun> for none or many
    And it warns against renaming to a find* that still answers null

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
