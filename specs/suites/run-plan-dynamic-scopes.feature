Feature: Dynamic run plan scopes
  As a person who keeps a run plan alive over months
  I want a plan to say which test cases it covers by rule
  So that a case added tomorrow runs without me editing the plan

  Background: what a plan covers.
    A run plan carries a scope. The scope is one of four modes: all test cases,
    the cases of chosen test suites, the cases carrying chosen labels, or a
    hand-picked list of cases.

    A plan stored before scopes carries none, which reads as the hand-picked
    list it already held. A test suite gets its cases from the filing of those
    cases, so it carries no scope at all.

    The scope is resolved when the run starts, so the run covers the test cases
    of that moment.

  @unit
  Scenario: The stored shape of every mode is known
    Given a scope value
    When it is read
    Then only the four modes are accepted
    And an unknown mode is refused

  @integration
  Scenario: A plan scoped to all scenarios runs every active case
    Given a project with three active test cases
    And a run plan scoped to all test cases
    When the plan is run
    Then all three test cases are scheduled

  @integration
  Scenario: A plan scoped to test suites runs the cases filed in them
    Given two test suites, each with one test case
    And a run plan scoped to the first test suite
    When the plan is run
    Then only the case of the first test suite is scheduled

  @integration
  Scenario: A plan scoped to labels runs the cases carrying them
    Given a test case labelled "checkout" and a test case labelled "search"
    And a run plan scoped to the label "checkout"
    When the plan is run
    Then only the checkout case is scheduled

  @integration
  Scenario: A plan scoped to a hand-picked list runs exactly that list
    Given a run plan holding one of two test cases
    When the plan is run
    Then only the held test case is scheduled

  @integration
  Scenario: A scenario added later runs on the next run
    Given a run plan scoped to a test suite
    And the plan has run once
    When a new test case is filed into that test suite
    And the plan is run again
    Then the new test case is scheduled too

  @integration
  Scenario: A scenario that loses the label drops out of the plan
    Given a run plan scoped to the label "checkout"
    And a test case carrying that label
    When the label is taken off the test case
    And the plan is run
    Then the test case is not scheduled

  @integration
  Scenario: Archived scenarios are left out of a dynamic scope
    Given a run plan scoped to all test cases
    And one of the test cases is archived
    When the plan is run
    Then only the active test cases are scheduled

  @integration
  Scenario: The resolved set is written back on the plan
    Given a run plan scoped to a test suite
    When the plan is run
    Then the plan reads back with the cases the run covered

  @integration
  Scenario: A dynamic scope that covers nothing is refused
    Given a run plan scoped to a label no test case carries
    When the plan is run
    Then the run is refused with the code "suite_scope_empty"
    And the person is told to widen the scope

  @integration
  Scenario: A scope cannot name another project's test suite
    Given a test suite in another project
    When a run plan is scoped to it
    And the plan is run
    Then no test case of the other project is scheduled

  @integration
  Scenario: A test suite refuses a scope
    Given a test suite
    When a scope is written on it
    Then the write is refused
