Feature: Dynamic run plan scopes
  As a person who keeps a run plan alive over months
  I want a plan to say which scenarios it covers by rule
  So that a scenario added tomorrow runs without me editing the plan

  Background: what a plan covers.
    A run plan carries a scope. The scope is one of four modes: all scenarios,
    the scenarios of chosen test suites, the scenarios carrying chosen labels, or a
    hand-picked list of scenarios.

    A plan stored before scopes carries none, which reads as the hand-picked
    list it already held. A test suite gets its scenarios from the filing of those
    scenarios, so it carries no scope at all.

    The scope is resolved when the run starts, so the run covers the scenarios
    of that moment.

  @unit
  Scenario: The stored shape of every mode is known
    Given a scope value
    When it is read
    Then only the four modes are accepted
    And an unknown mode is refused

  @integration
  Scenario: A plan scoped to all scenarios runs every active scenario
    Given a project with three active scenarios
    And a run plan scoped to all scenarios
    When the plan is run
    Then all three scenarios are scheduled

  @integration
  Scenario: A plan scoped to test suites runs the scenarios filed in them
    Given two test suites, each with one scenario
    And a run plan scoped to the first test suite
    When the plan is run
    Then only the scenario of the first test suite is scheduled

  @integration
  Scenario: A plan scoped to labels runs the scenarios carrying them
    Given a scenario labelled "checkout" and a scenario labelled "search"
    And a run plan scoped to the label "checkout"
    When the plan is run
    Then only the checkout scenario is scheduled

  @integration
  Scenario: A plan scoped to a hand-picked list runs exactly that list
    Given a run plan holding one of two scenarios
    When the plan is run
    Then only the held scenario is scheduled

  @integration
  Scenario: A scenario added later runs on the next run
    Given a run plan scoped to a test suite
    And the plan has run once
    When a new scenario is filed into that test suite
    And the plan is run again
    Then the new scenario is scheduled too

  @integration
  Scenario: A scenario that loses the label drops out of the plan
    Given a run plan scoped to the label "checkout"
    And a scenario carrying that label
    When the label is taken off the scenario
    And the plan is run
    Then the scenario is not scheduled

  @integration
  Scenario: Archived scenarios are left out of a dynamic scope
    Given a run plan scoped to all scenarios
    And one of the scenarios is archived
    When the plan is run
    Then only the active scenarios are scheduled

  @integration
  Scenario: The resolved set is written back on the plan
    Given a run plan scoped to a test suite
    When the plan is run
    Then the plan reads back with the scenarios the run covered

  @integration
  Scenario: A dynamic scope that covers nothing is refused
    Given a run plan scoped to a label no scenario carries
    When the plan is run
    Then the run is refused with the code "suite_scope_empty"
    And the person is told to widen the scope

  @integration
  Scenario: A scope cannot name another project's test suite
    Given a test suite in another project
    When a run plan is scoped to it
    And the plan is run
    Then no scenario of the other project is scheduled

  @integration
  Scenario: A test suite refuses a scope
    Given a test suite
    When a scope is written on it
    Then the write is refused
