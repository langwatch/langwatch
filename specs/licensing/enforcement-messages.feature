@wip @integration
Feature: Message/Trace Limit Enforcement with License
  As a LangWatch self-hosted deployment with a license
  I want the monthly message limit to be enforced
  So that organizations respect their licensed trace quota

  Background:
    Given an organization "org-123" exists
    And a team "team-456" exists in the organization
    And a project "project-789" exists in the team

  # ============================================================================
  # TraceUsageService with License Limits
  # ============================================================================

  Scenario: Reports not exceeded when under monthly limit
    Given the organization has a license with maxMessagesPerMonth 10000
    And the organization has 5000 traces this month
    When I check the trace limit for team "team-456"
    Then exceeded is false

  Scenario: Reports exceeded when at monthly limit
    Given the organization has a license with maxMessagesPerMonth 10000
    And the organization has 10000 traces this month
    When I check the trace limit for team "team-456"
    Then exceeded is true
    And the message contains "Monthly limit of 10000 traces reached"

  Scenario: Reports exceeded when over monthly limit
    Given the organization has a license with maxMessagesPerMonth 10000
    And the organization has 15000 traces this month
    When I check the trace limit for team "team-456"
    Then exceeded is true

  Scenario: Returns correct count and limit values
    Given the organization has a PRO license with maxMessagesPerMonth 50000
    And the organization has 25000 traces this month
    When I check the trace limit for team "team-456"
    Then the response includes:
      | count               | 25000  |
      | maxMessagesPerMonth | 50000  |
      | planName            | PRO    |

  # ============================================================================
  # Invalid/Expired License (Temporary Self-Hosted Compatibility)
  # NOTE: Transitional policy — during compatibility window, self-hosted fallback
  # FREE plan does not block trace ingestion. This will be lifted in a future PR.
  # ============================================================================

  Scenario: Expired license does not block ingestion during compatibility window
    Given the organization has an expired license
    And the organization has 1000 traces this month
    When I check the trace limit for team "team-456"
    Then exceeded is false

  Scenario: Invalid license does not block ingestion during compatibility window
    Given the organization has an invalid license signature
    And the organization has 500 traces this month
    When I check the trace limit for team "team-456"
    Then exceeded is false

  Scenario: Invalid license remains unblocked even at FREE tier count during compatibility window
    Given the organization has an invalid license signature
    And the organization has 1000 traces this month
    When I check the trace limit for team "team-456"
    Then exceeded is false

  # ============================================================================
  # Caching Behavior
  # ============================================================================

  Scenario: Uses cached count within TTL
    Given the organization has a license with maxMessagesPerMonth 10000
    And the organization has 5000 traces this month
    And the count was cached 2 minutes ago
    When I check the trace limit for team "team-456"
    Then the Elasticsearch query is not executed
    And the cached count is returned

  Scenario: Refreshes count after cache expires
    Given the organization has a license with maxMessagesPerMonth 10000
    And the count was cached 6 minutes ago
    When I check the trace limit for team "team-456"
    Then the Elasticsearch query is executed
    And the cache is updated

  # ============================================================================
  # Cross-Project Aggregation
  # ============================================================================

  Scenario: Aggregates traces across all organization projects
    Given the organization has a license with maxMessagesPerMonth 10000
    And a project "project-abc" exists in the team
    And a project "project-def" exists in the team
    And project "project-789" has 4000 traces this month
    And project "project-abc" has 3000 traces this month
    And project "project-def" has 4000 traces this month
    When I check the trace limit for team "team-456"
    Then exceeded is true
    And count is 11000
