@integration
Feature: New Evaluation Menu
  As a user
  I want a dropdown menu with evaluation options
  So that I can choose between experiments, online evaluations, and guardrails

  Background:
    Given I am logged in to a project
    And I am on the evaluations page

  Scenario: Display dropdown menu with three options
    When I click the "New Evaluation" button
    Then a dropdown menu should appear with options:
      | Option                | Subtitle                                           |
      | New Experiment        | Compare prompts and model performance side by side |
      | New Online Evaluation | Monitor live traces and capture performance signals|
      | New Guardrail         | Block dangerous requests and harmful outputs       |

  Scenario: New Experiment opens dialog and creates experiment
    Given the dropdown menu is open
    When I click "New Experiment"
    Then a dialog should appear asking for experiment name
    And the dialog should have a text input field
    And the dialog should have a "Create" button

  Scenario: Create experiment with name
    Given I click "New Experiment" from the menu
    And a dialog appears asking for name
    When I enter "My Experiment" and confirm
    Then an experiment should be created with name "My Experiment"
    And the experiment slug should contain "my-experiment"
    And I should be redirected to /evaluations/v3/[slug]

  Scenario: Create experiment with empty name
    Given the new experiment dialog is open
    When I try to submit with an empty name
    Then the Create button should be disabled
    Or a validation error should appear

  Scenario: Cancel experiment creation
    Given the new experiment dialog is open
    When I click Cancel or close the dialog
    Then no experiment should be created
    And I should remain on the evaluations page

  Scenario: New Online Evaluation opens drawer
    Given the dropdown menu is open
    When I click "New Online Evaluation"
    Then the Online Evaluation drawer should open
    And the drawer should have trace/thread level selector

  Scenario: New Guardrail opens evaluator list
    Given the dropdown menu is open
    When I click "New Guardrail"
    Then the evaluator list drawer should open
    And the guardrails flow should begin

  Scenario: Menu closes on outside click
    Given the dropdown menu is open
    When I click outside the menu
    Then the menu should close

  Scenario: Menu closes after option selection
    Given the dropdown menu is open
    When I click any option
    Then the menu should close
    And the corresponding action should be triggered
