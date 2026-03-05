Feature: External SDK/CI sets in suites sidebar
  As a LangWatch user
  I want to see scenario sets sent from SDK/CI in the suites sidebar
  So that I can monitor external evaluation runs alongside platform suites

  Background:
    Given I am logged into project "my-project"
    And suites are available

  # Happy path - external sets appear and are navigable

  @e2e
  Scenario: External sets section appears with SDK-submitted scenario runs
    Given an SDK client has submitted scenario runs with scenarioSetId "nightly-regression"
    And "nightly-regression" is not associated with any platform suite
    When I view the suites sidebar
    Then I see an "External Sets" section below the Suites section
    And "nightly-regression" appears in the External Sets section

  @e2e
  Scenario: Clicking an external set opens the batch view
    Given an SDK client has submitted scenario runs with scenarioSetId "nightly-regression"
    When I click "nightly-regression" in the External Sets section
    Then the batch view loads showing all scenario runs for "nightly-regression"

  # Display and status summary

  @integration
  Scenario: External set entry shows pass rate and recency
    Given scenarioSetId "ci-smoke-tests" last ran 1 hour ago with 15/20 passing
    And "ci-smoke-tests" is not associated with any platform suite
    When I view the suites sidebar
    Then "ci-smoke-tests" shows "15/20 passed" and recency in the External Sets section

  @integration
  Scenario Outline: External set shows correct status indicator
    Given scenarioSetId "ci-smoke-tests" last ran 30 minutes ago with <passed>/<total> passing
    And "ci-smoke-tests" is not associated with any platform suite
    When I view the suites sidebar
    Then "ci-smoke-tests" shows <icon> icon with "<passed>/<total> passed" and recency

    Examples:
      | passed | total | icon      |
      | 10     | 10    | checkmark |
      | 7      | 10    | error     |

  @integration
  Scenario: External set uses scenarioSetId as its display name
    Given an SDK client has submitted scenario runs with scenarioSetId "my-custom-set-name"
    When I view the suites sidebar
    Then the entry displays "my-custom-set-name" as its name with no alias

  # Read-only behavior

  @integration
  Scenario: External set batch view is read-only
    Given scenarioSetId "ci-smoke-tests" exists as an external set
    When I click "ci-smoke-tests" in the External Sets section
    Then no Run button is available for "ci-smoke-tests"
    And the batch view does not show an Edit Scenario action
    And the batch view does not show a Run Again action

  # Filtering and search

  @integration
  Scenario: Search filters across both Suites and External Sets
    Given suite "Billing Tests" exists
    And scenarioSetId "billing-ci" exists as an external set
    When I type "billing" in the sidebar search
    Then "Billing Tests" appears in the Suites section
    And "billing-ci" appears in the External Sets section

  @integration
  Scenario: Search with no matches hides both sections
    Given suite "Billing Tests" exists
    And scenarioSetId "billing-ci" exists as an external set
    When I type "zzz-no-match" in the sidebar search
    Then neither the Suites section nor the External Sets section is visible

  # Empty state

  @integration
  Scenario: External Sets section is hidden when no external sets exist
    Given no scenario runs have been submitted with an unlinked scenarioSetId
    When I view the suites sidebar
    Then the "External Sets" section is not visible

  # Exclusion of platform-linked sets

  @integration
  Scenario: Sets associated with a platform suite do not appear in External Sets
    Given scenarioSetId "linked-set" is associated with platform suite "My Suite"
    When I view the suites sidebar
    Then "linked-set" does not appear in the External Sets section
    And "My Suite" appears in the Suites section

  # Multiple external sets ordering

  @integration
  Scenario: External sets are ordered by most recent run
    Given scenarioSetId "old-set" last ran 2 days ago
    And scenarioSetId "recent-set" last ran 10 minutes ago
    When I view the suites sidebar
    Then "recent-set" appears before "old-set" in the External Sets section
