@integration
Feature: New Evaluation Menu
  As a user
  I want a dropdown menu with evaluation options
  So that I can choose between experiments, online evaluations, and guardrails

  Background:
    Given I am logged in to a project
    And I am on the evaluations page

  @unimplemented
  Scenario: Display dropdown menu with three options
    When I click the "New Evaluation" button
    Then a dropdown menu should appear with options:
      | Option                | Subtitle                                           |
      | New Experiment        | Compare prompts and model performance side by side |
      | New Online Evaluation | Monitor live traces and capture performance signals|
      | New Guardrail         | Block dangerous requests and harmful outputs       |

  @unimplemented
  Scenario: Create experiment with name
    Given I click "New Experiment" from the menu
    And a dialog appears asking for name
    When I enter "My Experiment" and confirm
    Then an experiment should be created with name "My Experiment"
    And the experiment slug should contain "my-experiment"
    And I should be redirected to /evaluations/v3/[slug]

