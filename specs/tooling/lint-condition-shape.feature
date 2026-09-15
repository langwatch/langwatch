Feature: The condition-shape lint rule
  A condition is readable at a glance or it is named. The rule measures the four
  ways a test stops being glanceable — property hops, calls, logical operators and
  a ternary inside the test — and reports the measurement alongside the fix, so the
  reader knows which of the four tripped it without counting by hand.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: An unreadable condition is reported with its measured shape
    Given a service module whose if-statement tests a three-hop property chain
    When the condition-shape rule runs over it
    Then it reports nameCondition
    And the message states the hops, calls and operators it measured
    And the message tells the reader to assign the condition to a const and test the name

  @unit
  Scenario: A condition within every limit is left alone
    Given a service module whose if-statement tests a single negated property
    When the condition-shape rule runs over it
    Then it reports nothing

  @unit
  Scenario: The option keys raise the limits the rule measures against
    Given a service module whose if-statement tests a three-hop property chain
    When the condition-shape rule runs with maxHops set to three
    Then it reports nothing
