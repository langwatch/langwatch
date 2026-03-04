Feature: Tag display for suites and scenarios
  As a user managing evaluation suites and scenarios
  I want tags to have a consistent appearance across the app
  So that labels are visually clear and easy to manage

  Background:
    Given I am logged into a project

  # --- Tag rendering ---

  @integration
  Scenario: Tags display with hash prefix
    Given I open a suite that has the label "critical"
    Then I see the tag "#critical"

  @integration
  Scenario: Tags can be removed
    Given I open a suite that has the label "billing"
    Then I see a remove control for the "billing" tag

  # --- Tag presence across surfaces ---

  @integration
  Scenario: Suite sidebar shows tags
    Given a suite exists with labels "nightly" and "regression"
    When I view the suites sidebar
    Then the suite entry displays its labels as tags

  @integration
  Scenario: Suite detail panel shows tags
    Given a suite exists with labels "critical" and "billing"
    When I view the suite detail panel
    Then the panel header displays its labels as tags

  @integration
  Scenario: Scenario table shows tags
    Given a scenario exists with labels "edge-case" and "auth"
    When I view the scenario library
    Then the scenario row displays its labels as tags

  # --- Add button ---

  @integration
  Scenario: An add button appears after existing tags
    Given I view a suite with labels "ci"
    Then a "+ add" button appears after the tags

  @integration
  Scenario: Clicking add button opens inline tag input
    Given I view a suite detail panel with labels
    When I click the "+ add" button
    Then an inline text input appears for entering a new label
