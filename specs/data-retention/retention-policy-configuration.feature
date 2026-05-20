Feature: Data retention policy configuration
  As a paid customer
  I want to configure how long my observability data is kept
  So that I can manage storage costs and comply with data governance policies

  Background:
    Given the organization has a SEAT_EVENT plan
    And the organization has a project

  Scenario: Organization sets default retention policy
    When the organization admin sets default retention to 30 days for all categories
    Then the organization defaultRetentionPolicy is saved as {"traces": 30, "scenarios": 30, "experiments": 30}
    And all projects without a project-level override inherit this default

  Scenario: Project overrides organization default
    Given the organization default retention is 30 days for all categories
    When the project admin sets project retention to 90 days for traces
    Then the project retentionPolicy is saved as {"traces": 90, "scenarios": null, "experiments": null}
    And trace data for this project uses 90-day retention
    And scenario data for this project inherits the 30-day org default
    And experiment data for this project inherits the 30-day org default

  Scenario: Resolution order falls through to indefinite
    Given the organization has no defaultRetentionPolicy set
    And the project has no retentionPolicy set
    Then data is stamped with _retention_days = 0
    And data is kept indefinitely

  Scenario: Minimum retention enforced at 30 days
    When the admin attempts to set retention to 15 days for traces
    Then the request is rejected with a validation error
    And the error indicates minimum retention is 30 days

  Scenario: Per-category retention with mixed values
    When the admin sets retention to {"traces": 90, "scenarios": 30, "experiments": null}
    Then trace data uses 90-day retention
    And scenario data uses 30-day retention
    And experiment data is kept indefinitely

  Scenario: Clearing project override restores org default
    Given the organization default retention is 60 days for all categories
    And the project has a 90-day override for traces
    When the project admin clears the project retention policy
    Then trace data for this project uses 60-day retention from the org default
