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

  # ============================================================================
  # Invalid/Expired License (Temporary Self-Hosted Compatibility)
  # NOTE: Transitional policy — during compatibility window, self-hosted fallback
  # FREE plan does not block trace ingestion. This will be lifted in a future PR.
  # ============================================================================

  # ============================================================================
  # Caching Behavior
  # ============================================================================

  @unimplemented
  Scenario: Uses cached count within TTL
    Given the organization has a license with maxMessagesPerMonth 10000
    And the organization has 5000 traces this month
    And the count was cached 2 minutes ago
    When I check the trace limit for team "team-456"
    Then the Elasticsearch query is not executed
    And the cached count is returned

  @unimplemented
  Scenario: Refreshes count after cache expires
    Given the organization has a license with maxMessagesPerMonth 10000
    And the count was cached 6 minutes ago
    When I check the trace limit for team "team-456"
    Then the Elasticsearch query is executed
    And the cache is updated

  # ============================================================================
  # Cross-Project Aggregation
  # ============================================================================

