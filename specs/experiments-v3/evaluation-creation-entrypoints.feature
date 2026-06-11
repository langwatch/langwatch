Feature: Creating and opening evaluations goes to the workbench
  As a user creating evaluations
  I want a single evaluation experience
  So that I am never sent to the old evaluation wizard

  # The evaluation wizard (and its AI dataset generation) was removed. Every
  # entry point that used to open the wizard now opens the evaluations
  # workbench, and old wizard URLs redirect there.

  @integration @unimplemented
  Scenario: Creating a new evaluation opens the workbench
    Given I am on the evaluations page
    When I create a new evaluation
    Then I land on a new evaluation workbench

  @integration @unimplemented
  Scenario: Opening a workbench-backed experiment opens the workbench
    Given an evaluation experiment exists
    When I click the experiment in the list
    Then it opens in the evaluations workbench

  @integration @unimplemented
  Scenario: Legacy wizard URLs redirect to the workbench
    Given a link to "/:project/evaluations/wizard/:slug"
    When I open it
    Then I am redirected to "/:project/experiments/workbench/:slug"
