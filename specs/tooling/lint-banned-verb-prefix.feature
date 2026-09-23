Feature: The banned-verb-prefix lint rule
  `try*` and `require*` name how a method behaves on failure rather than what
  it answers, so neither is a verb (ADR-146). A `try*` name is reported once:
  when its own body catches a failure and answers null or undefined, the
  message names that catch and tells the author to delete it; otherwise the
  message never claims a catch it cannot see. Either way the rename is the
  ADR-146 one: `get<Noun>`/`getBy<Key>` throwing for one thing, `find<Noun>`
  returning an array for none or many, or a derivation verb that may answer
  undefined — never a `find*` that still answers null. A `require*` name
  that answers a value becomes `get<Noun>`, which already answers one thing
  or throws; one that answers nothing becomes `assert<Condition>`. A private
  method's name is no caller's contract and is left alone.

  Background:
    Given a workspace whose agent module has a contract and a process half

  @unit
  Scenario: A try-prefixed name is refused without claiming a catch
    Given a method, abstract method, interface signature, function or module-scope arrow const named try<Noun> with no swallowing catch
    When the banned-verb-prefix rule runs over it
    Then it reports tryPrefix once per name, on the name's line

  @unit
  Scenario: The try message never claims a catch and never prescribes a nullable find
    Given a try-prefixed function whose body has no catch at all
    When the banned-verb-prefix rule runs over it
    Then the message says to drop try and names get<Noun> and an array-returning find<Noun>
    And it never mentions a catch
    And it warns against a find* that still answers null

  @unit
  Scenario: A swallowing try is reported once, naming its catch
    Given a try-prefixed declaration whose catch answers null, undefined or nothing, or whose promise chain ends in a catch answering null
    When the banned-verb-prefix rule runs over it
    Then it reports swallowingTry and not tryPrefix
    And the message tells the author to delete the catch and never to rename to a nullable find

  @unit
  Scenario: A require prefix is reported with the get rename
    Given an interface signature named require<Noun>
    When the banned-verb-prefix rule runs over it
    Then it reports requirePrefix naming get<Noun> as the rename
    And a function whose body returns a value reports requirePrefix too

  @unit
  Scenario: A require prefix that throws on failure is reported with the assert rename
    Given require-prefixed names declared void, Promise<void> or asserts, and bodies that return no value
    When the banned-verb-prefix rule runs over them
    Then it reports requireAssertion on each name's line naming assert<Condition> as the rename

  @unit
  Scenario: A private or unprefixed name is left alone
    Given a private try-prefixed method, an arrow nested in a method body, and a find method
    When the banned-verb-prefix rule runs over them
    Then it reports nothing
