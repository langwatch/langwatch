Feature: The condition-shape lint rule
  A condition is readable at a glance or it is named. What costs a reader is a test
  that calls or combines — more than one call, a stack of logical operators, or a
  ternary inside the test — and the rule reports each exceeded limit on its own,
  naming the limit and the value it measured, so the reader knows which of them
  tripped it without counting by hand. A property
  chain is a path to a value rather than complexity of its own, so its depth counts
  only once the test already calls or combines.

  The rule's own defaults are one call, two operators and two hops. **This
  repository configures it looser**, at three calls, four operators and three
  hops, and the reason is in what the defaults were reporting: 323 of 630
  findings were a condition with exactly two calls in it, which is
  `isEnabled(flag) && isReady(row)` — two named predicates joined by an `and`.
  That is the readable form, and rewriting it into guard clauses buys nothing.
  What the looser setting still catches is a test doing genuinely too much at
  once, and it is 106 sites rather than 630.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: An unreadable condition is reported with its measured shape
    Given a service module whose if-statement tests a three-hop property chain against another
    When the condition-shape rule runs over it
    Then it reports chainTooDeep
    And the message states the hops it measured and the maxHops limit
    And the message tells the reader to read the chain into a named const

  @unit
  Scenario: Each exceeded limit is its own report
    Given a service module whose if-statement makes two calls, joins four operators, reads a deep chain and nests a ternary
    When the condition-shape rule runs over it
    Then it reports tooManyCalls, tooManyOperators, chainTooDeep and ternaryInTest on that line
    And each message names its limit and the value it measured

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
