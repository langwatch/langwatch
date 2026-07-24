@monitors @evaluations
Feature: Replicate an online evaluator to another project
  As a user with several projects
  I want to replicate an online evaluator (monitor) into another project
  So that I can reuse the same evaluation setup without rebuilding it by hand

  # Online evaluators are listed as cards on the evaluations page. The card
  # overflow menu offers "Replicate to another project". Previously this only
  # appeared for legacy wizard-created monitors (the ones backed by an
  # experiment) and, even then, it copied the experiment without producing a
  # working monitor in the target. It must work for every monitor, including
  # the ones created through the online-evaluation drawer.

  Background:
    Given I am authenticated with "evaluations:manage" permission
    And I have access to a source project and a target project in the same organization

  Rule: The replicate action is available for every online evaluator

    Scenario: Replicate is offered for a drawer-created monitor
      Given a monitor created through the online-evaluation drawer
      And the monitor is not backed by an experiment
      When I open the monitor card overflow menu
      Then I see a "Replicate to another project" action

    Scenario: Replicate is offered for a legacy wizard monitor
      Given a monitor backed by an experiment
      When I open the monitor card overflow menu
      Then I see a "Replicate to another project" action

  Rule: Replicating recreates a working monitor in the target project

    Scenario: Replicating a monitor whose settings live on the monitor
      Given a monitor in the source project with no linked evaluator
      When I replicate it to the target project
      Then a new monitor exists in the target project
      And the new monitor evaluates traces the same way the original did
      And the new monitor is created disabled so it does not start evaluating until I review it
      And the source monitor is left unchanged

    Scenario: Replicating a monitor backed by a reusable evaluator
      Given a monitor in the source project linked to an evaluator
      When I replicate it to the target project
      Then the linked evaluator is also copied into the target project
      And the new monitor is linked to the copied evaluator, not the source one

    Scenario: Replicating a monitor backed by a workflow evaluator
      Given a monitor in the source project linked to a workflow evaluator
      When I replicate it to the target project
      Then the workflow is copied into the target project
      And the copied evaluator in the target project points at the copied workflow
      And the new monitor runs the same workflow evaluation in the target project

  Rule: Replication respects permissions and naming

    Scenario: Target project requires create permission
      Given I do not have "evaluations:manage" permission in the target project
      When I attempt to replicate a monitor there
      Then the replication is rejected

    Scenario: Name collisions are de-duplicated in the target project
      Given the target project already has a monitor with the same name
      When I replicate a monitor with that name
      Then the new monitor name is suffixed so both remain distinct
