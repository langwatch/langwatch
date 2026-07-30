@unit
Feature: The event-sourcing core knows nothing about where state is kept
  The core describes how events become state: what an aggregate is, how a
  projection applies an event, which lane work is queued into. Where that state
  lands is a separate question, and one the core deliberately cannot answer.

  Keeping the two apart is not tidiness. State already lands in more than one
  place — some projections keep theirs in an analytical column store, one keeps
  its in a relational row — and a core that knew about the first would have made
  the second an exception to itself rather than an ordinary use of the same
  interface. It also runs the other way: plenty of code reads the analytical
  store without going near a projection, and it should not have to depend on
  event sourcing to run a query.

  So the core states the contracts and something else implements them. The
  boundary is checked rather than described, because a boundary that is only
  described is one the next reasonable-looking import quietly ends. (ADR-102.)

  Background:
    Given the event-sourcing core is packaged separately from the application

  Scenario: the core does not reach into the application
    When the core's sources are examined
    Then none of them refers to an application module

  Scenario: the check covers imports that do not look like imports
    Given a module brought in only for its side effects
    And a module brought in only for its types
    And a module brought in while the program is running
    When the core's sources are examined
    Then each of those counts as a reference

  Scenario: the check follows what the package says it depends on
    Given the core declares the packages it is allowed to use
    When a new dependency is declared
    Then using it is permitted without changing the check
    And using something undeclared is still reported

  @unimplemented
  Scenario: the core names a place to keep state without naming a technology
    When a projection is written against the core alone
    Then it can say that its state is loaded and stored
    And it cannot say which store will do that

  @unimplemented
  Scenario: two different stores satisfy the same projection unchanged
    Given a projection whose state is kept in an analytical column store
    And an otherwise identical projection whose state is kept in a relational row
    When each is registered
    Then neither is treated as a special case of the other

  @unimplemented
  Scenario: reading the analytical store does not require event sourcing
    Given code that queries the analytical store and projects nothing
    When it is written
    Then it depends on the storage package alone

  @unimplemented
  Scenario: the storage package is not reachable from the core
    When the core's declared dependencies are examined
    Then the storage package is not among them
