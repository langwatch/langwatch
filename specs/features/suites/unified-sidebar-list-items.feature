Feature: Unified sidebar list items for suites and external sets
  As a LangWatch user
  I want external set items in the sidebar to look the same as suite items
  So that I have a consistent experience regardless of where the evaluation runs originated

  Background:
    Given I am logged into project "my-project"

  # The core unification behavior: both item types display the same information
  # using shared building blocks (status icon, summary line, layout wrapper).
  # Each keeps its own component but composes from the same pieces.

  @integration
  Scenario: External set item displays the same information as a suite item
    Given suite "Billing Tests" last ran 1 hour ago with 8/10 passing
    And scenarioSetId "ci-smoke-tests" last ran 30 minutes ago with 15/20 passing
    When I view the suites sidebar
    Then both "Billing Tests" and "ci-smoke-tests" display a name, status icon, pass count, and recency

  @integration
  Scenario: External set item does not show a Run button
    Given scenarioSetId "ci-smoke-tests" last ran 1 hour ago with 15/20 passing
    When I view the suites sidebar
    Then the "ci-smoke-tests" list item does not contain a Run button

  @integration
  Scenario: Suite item shows a Run button
    Given suite "Billing Tests" exists with completed runs
    When I view the suites sidebar
    Then the "Billing Tests" list item contains a Run button

  @integration
  Scenario: External set item does not show a three-dot context menu on hover
    Given scenarioSetId "ci-smoke-tests" last ran 1 hour ago with 15/20 passing
    When I hover over "ci-smoke-tests" in the sidebar
    Then no three-dot menu button appears for "ci-smoke-tests"

  @integration
  Scenario: Suite item shows a three-dot context menu on hover
    Given suite "Billing Tests" exists with completed runs
    When I hover over "Billing Tests" in the sidebar
    Then a three-dot menu button appears for "Billing Tests"

  # Component rendering tests verify the external set list item composes
  # shared building blocks (StatusIcon, RunSummaryLine) like the suite list item.

  @integration
  Scenario: External set list item displays pass count and recency using shared building blocks
    Given an external set list item with name "ci-smoke-tests" and 15/20 passed 30 minutes ago
    When the list item renders
    Then it displays a status icon, "15 passed", and a recency indicator

  @integration
  Scenario: External set list item displays no summary when there are no runs
    Given an external set list item with name "New Set" and no run summary
    When the list item renders
    Then it displays only the name with no summary line
