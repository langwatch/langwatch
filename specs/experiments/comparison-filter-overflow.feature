@integration
Feature: Experiment comparison filter controls stay fully visible
  As a user comparing batch evaluation runs
  I want the toolbar dropdowns (Group by, Metrics) to render in full
  So that I can pick filters without parts of the menu being cut off by the chart container

  Background:
    Given I am viewing an experiment with 3 batch runs and 6 evaluators
    And the comparison charts panel is visible

  Scenario: Metrics dropdown is fully visible when opened
    When I open the Metrics selector
    Then the dropdown shows every available metric option
    And no option is clipped by the chart container edge

  Scenario: Group-by dropdown is fully visible when opened
    Given the dataset entries carry metadata fields
    When I open the Group by selector
    Then the dropdown shows every available grouping option
    And no option is clipped by the chart container edge

  @unimplemented
  Scenario: Long metric names do not push the dropdown off-screen
    Given the experiment has evaluators with long names
    When I open the Metrics selector near the right edge of the viewport
    Then the dropdown stays within the visible viewport
    And every option label is readable end-to-end

  Scenario: Tall option list scrolls inside the dropdown
    Given the experiment has more than 10 selectable metrics
    When I open the Metrics selector
    Then the dropdown does not exceed the viewport height
    And I can scroll within the dropdown to reach every option

  @unimplemented
  Scenario: Dropdown closes when clicking outside
    When I open the Metrics selector
    And I click outside the dropdown
    Then the dropdown closes
