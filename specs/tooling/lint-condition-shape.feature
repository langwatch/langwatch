Feature: The condition-shape lint rule
  A condition is readable at a glance or it is named. What costs a reader is a test
  that calls or combines — more than one call, a stack of logical operators, or a
  ternary inside the test — and the rule reports the measurement alongside the fix,
  so the reader knows which of them tripped it without counting by hand. A property
  chain is a path to a value rather than complexity of its own, so its depth counts
  only once the test already calls or combines.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: An unreadable condition is reported with its measured shape
    Given a service module whose if-statement tests a three-hop property chain against another
    When the condition-shape rule runs over it
    Then it reports nameCondition
    And the message states the hops, calls and operators it measured
    And the message tells the reader to name the condition for what the branch means

  @unit
  Scenario: A property chain on its own is never reported
    Given a service module whose if-statement compares the length of a three-hop chain
    When the condition-shape rule runs over it
    Then it reports nothing
    And a chain of any depth is left alone while the test neither calls nor combines

  @unit
  Scenario: A condition within every limit is left alone
    Given a service module whose if-statement tests a single negated property
    When the condition-shape rule runs over it
    Then it reports nothing

  @unit
  Scenario: The option keys raise the limits the rule measures against
    Given a service module whose if-statement tests a three-hop property chain against another
    When the condition-shape rule runs with maxHops set to three
    Then it reports nothing
