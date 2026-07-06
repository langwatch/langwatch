Feature: Usage enforcement plan resolution
  As the usage enforcement service
  I want to reuse the active plan already resolved for a limit check
  So that enforcement compares usage and thresholds from the same plan snapshot

  @unit
  Scenario: Limit checks decide from one active plan snapshot
    Given an organization belongs to team "team-123"
    And the active plan allows 1000 monthly events
    And a later active plan lookup would allow 2000 monthly events
    And the organization has 1000 events this month
    When I check the monthly usage limit for team "team-123"
    Then the limit check reports that usage is exceeded
    And the result uses the 1000-event threshold from the first active plan snapshot
    And the later active plan value is not used during the same check
