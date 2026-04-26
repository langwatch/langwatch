Feature: External SDK/CI sets in suites sidebar
  As a LangWatch user
  I want to see scenario sets sent from SDK/CI in the suites sidebar
  So that I can monitor external evaluation runs alongside platform suites

  Background:
    Given I am logged into project "my-project"
    And suites are available

  # Happy path - external sets appear and are navigable

  @e2e @unimplemented
  Scenario: Clicking an external set opens the batch view
    Given an SDK client has submitted scenario runs with scenarioSetId "nightly-regression"
    When I click "nightly-regression" in the External Sets section
    Then the batch view loads showing all scenario runs for "nightly-regression"

  # Display and status summary

  @integration @unimplemented
  Scenario: External set batch view is read-only
    Given scenarioSetId "ci-smoke-tests" exists as an external set
    When I click "ci-smoke-tests" in the External Sets section
    Then no Run button is available for "ci-smoke-tests"
    And the batch view does not show an Edit Scenario action
    And the batch view does not show a Run Again action

  # Filtering and search

  @integration @unimplemented
  Scenario: Search filters across both Suites and External Sets
    Given suite "Billing Tests" exists
    And scenarioSetId "billing-ci" exists as an external set
    When I type "billing" in the sidebar search
    Then "Billing Tests" appears in the Suites section
    And "billing-ci" appears in the External Sets section

  @integration @unimplemented
  Scenario: Search with no matches hides both sections
    Given suite "Billing Tests" exists
    And scenarioSetId "billing-ci" exists as an external set
    When I type "zzz-no-match" in the sidebar search
    Then neither the Suites section nor the External Sets section is visible

  # Empty state

  @integration @unimplemented
  Scenario: Sets associated with a platform suite do not appear in External Sets
    Given scenarioSetId "linked-set" is associated with platform suite "My Suite"
    When I view the suites sidebar
    Then "linked-set" does not appear in the External Sets section
    And "My Suite" appears in the Suites section

  # Multiple external sets ordering

  @integration @unimplemented
  Scenario: External sets are ordered by most recent run
    Given scenarioSetId "old-set" last ran 2 days ago
    And scenarioSetId "recent-set" last ran 10 minutes ago
    When I view the suites sidebar
    Then "recent-set" appears before "old-set" in the External Sets section
