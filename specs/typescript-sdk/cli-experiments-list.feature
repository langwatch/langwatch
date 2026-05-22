@integration
Feature: List experiments and evaluation runs from the LangWatch CLI
  As a developer wiring CI scripts and ad-hoc queries
  I want `langwatch experiment list` and `langwatch experiment list-runs`
  So that I can discover experiment slugs and run ids without opening the dashboard

  Background:
    Given LANGWATCH_API_KEY is set in the environment

  # ==========================================================================
  # langwatch experiment list
  # ==========================================================================

  Scenario: Listing experiments prints a table by default
    Given the project owns experiments "checkout-flow" and "support-bot"
    When I run "langwatch experiment list"
    Then the exit code is 0
    And the output contains the headers "Name", "Slug", "Last Run", "Runs"
    And each owned experiment slug appears in the table

  Scenario: JSON format dumps the raw payload
    When I run "langwatch experiment list --format json"
    Then the exit code is 0
    And the output is valid JSON
    And each entry has "id", "slug", "name", "type"

  @unimplemented
  Scenario: Limit caps the number of rows shown
    Given the project owns 30 experiments
    When I run "langwatch experiment list --limit 5"
    Then the exit code is 0
    And at most 5 experiment rows are printed

  @unimplemented
  Scenario: Missing API key prints a friendly error
    Given LANGWATCH_API_KEY is not set
    When I run "langwatch experiment list"
    Then the exit code is non-zero
    And the output mentions "LANGWATCH_API_KEY"

  # ==========================================================================
  # langwatch experiment list-runs
  # ==========================================================================

  Scenario: Listing runs requires --experiment
    When I run "langwatch experiment list-runs"
    Then the exit code is non-zero
    And the output mentions "experiment"

  Scenario: Listing runs prints a table for a known slug
    Given the experiment "checkout-flow" has 2 completed runs
    When I run "langwatch experiment list-runs --experiment checkout-flow"
    Then the exit code is 0
    And the output contains the headers "Run ID", "Status", "Started"
    And both run ids appear in the table

  Scenario: JSON format on runs dumps the raw payload
    When I run "langwatch experiment list-runs --experiment checkout-flow --format json"
    Then the exit code is 0
    And the output is valid JSON

  @unimplemented
  Scenario: Unknown experiment slug exits non-zero with a 404 message
    When I run "langwatch experiment list-runs --experiment does-not-exist"
    Then the exit code is non-zero
    And the output mentions "404" or "not found"
