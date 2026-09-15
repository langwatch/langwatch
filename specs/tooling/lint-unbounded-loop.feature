Feature: The unbounded-loop lint rule
  A strict feature server loop states when it stops in its header. for (;;)
  and while (true) move the exit into the body, where the reader has to find
  every return, break and throw to learn when the loop ends. A wait carries
  its deadline in the header, a retry counts a named budget, a poll runs
  while time remains.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A loop without an exit condition in its header is reported
    Given a server module with a for (;;), a while (true) or a do … while (true)
    When the unbounded-loop rule runs over it
    Then it reports unboundedLoop naming the loop form
    And the fix names the deadline, the budget or a method whose signature carries the wait

  @unit
  Scenario: A loop with its exit condition in the header is left alone
    Given a server module whose loops test a deadline, count a budget or iterate a collection
    When the unbounded-loop rule runs over it
    Then it reports nothing
