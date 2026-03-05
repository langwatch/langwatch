Feature: Unified FREE plan experience
  As a SaaS platform operator
  I want all free-tier organizations to get the same allowance and metering
  So that the free experience is consistent regardless of pricing model

  Background:
    Given the platform is running in SaaS mode

  # ============================================================================
  # Event Limits
  # ============================================================================

  @integration
  Scenario: TIERED organization on FREE plan gets 50,000 events per month
    Given an organization with the TIERED pricing model
    And no active subscription exists
    When the plan provider resolves the active plan
    Then the plan is FREE with 50,000 events per month

  @integration
  Scenario: SEAT_EVENT organization on FREE plan gets 50,000 events per month
    Given an organization with the SEAT_EVENT pricing model
    And no active subscription exists
    When the plan provider resolves the active plan
    Then the plan is FREE with 50,000 events per month

  @integration
  Scenario: Organization not found gets 50,000 events per month
    Given the organization does not exist in the database
    And no active subscription exists
    When the plan provider resolves the active plan
    Then the plan is FREE with 50,000 events per month

  @integration
  Scenario: Custom subscription limits override the base free allowance
    Given an organization with the SEAT_EVENT pricing model
    And an active subscription with an unrecognized plan key
    And the subscription allows 100,000 events per month
    When the plan provider resolves the active plan
    Then the plan is FREE with 100,000 events per month

  @integration
  Scenario: Valid subscription returns its own plan regardless of pricing model
    Given an organization with the SEAT_EVENT pricing model
    And an active subscription on the LAUNCH plan
    When the plan provider resolves the active plan
    Then the plan is LAUNCH with standard LAUNCH limits

  @unit
  Scenario Outline: All pricing models get 50,000 events on the free tier
    When resolving free plan limits for <pricingModel>
    Then the limit is 50,000 events per month

    Examples:
      | pricingModel |
      | TIERED       |
      | SEAT_EVENT   |
      | null         |
      | undefined    |

  # ============================================================================
  # Usage counting — free tier counts every span as one unit
  # ============================================================================

  @unit
  Scenario: Free TIERED organization counts each span toward the limit
    Given a free organization originally on the TIERED pricing model
    When a trace with 5 spans is ingested
    Then 5 units are counted toward the monthly limit

  @unit
  Scenario: Free SEAT_EVENT organization counts each span toward the limit
    Given a free organization on the SEAT_EVENT pricing model
    When a trace with 5 spans is ingested
    Then 5 units are counted toward the monthly limit

  @unit
  Scenario: Paid TIERED organization counts each trace as one unit
    Given a paid organization on the TIERED pricing model
    When a trace with 5 spans is ingested
    Then 1 unit is counted toward the monthly limit

  @unit
  Scenario: Paid SEAT_EVENT organization counts each span toward the limit
    Given a paid organization on the SEAT_EVENT pricing model
    When a trace with 5 spans is ingested
    Then 5 units are counted toward the monthly limit

  @unit
  Scenario: Licensed organization respects its own counting rule
    Given an organization with an active license that specifies trace-based counting
    When a trace with 5 spans is ingested
    Then 1 unit is counted toward the monthly limit

  # ============================================================================
  # Self-hosted — free plan does not block ingestion
  # ============================================================================

  @unit
  Scenario: Self-hosted free organization is never blocked
    Given the platform is running in self-hosted mode
    And a free organization on the TIERED pricing model
    And the organization has exceeded the monthly limit
    When a trace is ingested
    Then ingestion is not blocked
