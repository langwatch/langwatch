@integration
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
    Given the organization has a license with maxMessagesPerMonth 50000
    And the organization has 25000 traces this month
    When I check the trace limit for team "team-456"
    Then the response includes:
      | count               | 25000  |
      | maxMessagesPerMonth | 50000  |
      | planName            | <plan> |

  # ============================================================================
  # No License (Unlimited)
  # ============================================================================

  Scenario: No license allows unlimited traces
    Given the organization has no license
    And the organization has 1000000 traces this month
    When I check the trace limit for team "team-456"
    Then exceeded is false

  # ============================================================================
  # Invalid/Expired License (FREE Tier)
  # ============================================================================

  Scenario: Expired license enforces FREE tier message limit of 1000
    Given the organization has an expired license
    And the organization has 1000 traces this month
    When I check the trace limit for team "team-456"
    Then exceeded is true

  Scenario: Invalid license enforces FREE tier message limit
    Given the organization has an invalid license signature
    And the organization has 500 traces this month
    When I check the trace limit for team "team-456"
    Then exceeded is false

  Scenario: Invalid license reports exceeded at FREE limit
    Given the organization has an invalid license signature
    And the organization has 1000 traces this month
    When I check the trace limit for team "team-456"
    Then exceeded is true

  # ============================================================================
  # Feature Flag Override
  # ============================================================================

  Scenario: Feature flag disabled allows unlimited traces
    Given the organization has a license with maxMessagesPerMonth 1000
    And the organization has 50000 traces this month
    And LICENSE_ENFORCEMENT_ENABLED is "false"
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
    And project "project-789" has 4000 traces this month
    And project "project-abc" has 3000 traces this month
    And project "project-def" has 4000 traces this month
    When I check the trace limit for team "team-456"
    Then exceeded is true
    And count is 11000
