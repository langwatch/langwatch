Feature: Unified FREE plan experience
  As a SaaS platform operator
  I want all free-tier organizations to get the same allowance and metering
  So that the free experience is consistent regardless of pricing model

  Background:
    Given the platform is running in SaaS mode

  # ============================================================================
  # Event Limits
  # ============================================================================

  @unit @unimplemented
  Scenario: Self-hosted free organization is never blocked
    Given the platform is running in self-hosted mode
    And a free organization on the TIERED pricing model
    And the organization has exceeded the monthly limit
    When a trace is ingested
    Then ingestion is not blocked
