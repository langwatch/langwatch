Feature: Trace records that a project was traced, admin or not

  A project's first real trace is recorded as trace's own fact, naming the
  project and its organization. Unlike the first-trace milestone, it does not
  need an organization admin, so peers that keep their own copy of "this
  organization has traced" see every organization. It carries no person and
  reaches no analytics sink by itself.

  @unit
  Scenario: A project's first real trace records it as traced, with its organization
    Given a project that has not received its first message
    When its first real trace is processed
    Then trace records one project traced fact naming the project and its organization

  @unit
  Scenario: A project with no organization admin is still recorded as traced
    Given a project whose organization has no admin member
    When its first real trace is processed
    Then trace records one project traced fact naming the organization
    And no first-trace milestone is recorded

  @unit
  Scenario: A project with no organization is recorded as traced with none
    Given a project whose team or organization is gone
    When its first real trace is processed
    Then the project traced fact names no organization

  @unit
  Scenario: A failed organization lookup records no project traced fact
    Given reading the project's organization fails
    When its first real trace is processed
    Then no project traced fact is recorded, not even one naming no organization
    And the project is still marked as having received its first message
    And one error naming the project is logged

  @unit
  Scenario: A redelivered first trace records the project as traced once
    Given a project's first real trace was handled
    When the same trace is delivered again
    Then trace records no second project traced fact
    And the fact is keyed by the project alone

  @unit
  Scenario: Only a project's first real trace records it as traced
    Given a sample trace, a Langy turn, or a project that already received its first message
    When the trace is processed
    Then no project traced fact is recorded

  @unit
  Scenario: A failed traced record still records the first trace
    Given recording the project traced fact fails
    When a project's first real trace is processed
    Then the project is still marked as having received its first message
    And the first-trace milestone is still recorded
    And one error naming the project is logged
