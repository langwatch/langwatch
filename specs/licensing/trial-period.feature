Feature: 14-Day Trial Period (Part 1 — Infrastructure)
  As a LangWatch Cloud operator
  I want new organizations to get a trial Subscription with full Growth plan limits
  So that users can evaluate the platform before paying

  # Trial = real Subscription record with isTrial: true, no Stripe backing.
  # User experiences the full paid Growth plan during trial.
  # Graceful downgrade at read-time when trial expires (no crons).
  # Part 1 is infrastructure only — trials are NOT activated for new signups yet.

  # ============================================================================
  # PlanProvider: Active Trial → GROWTH_SEAT Limits
  # ============================================================================

  @unit
  Scenario: Active trial subscription returns GROWTH_SEAT limits
    Given a SaaS organization
    And the organization has a trial subscription ending in the future
    When the plan is resolved for the organization
    Then the plan type is "GROWTH_SEAT_EUR_MONTHLY"
    And activeTrial is true
    And trialEndDate matches the subscription end date

  @unit
  Scenario: Active trial subscription gives full paid experience
    Given a SaaS organization
    And the organization has a trial subscription ending in the future
    When the plan is resolved for the organization
    Then the plan is not free
    And the plan allows multiple members

  @unit
  Scenario: Trial subscription respects custom limit overrides
    Given a SaaS organization
    And the organization has a trial subscription with a custom maxMembers override
    When the plan is resolved for the organization
    Then the maxMembers limit matches the custom override

  # ============================================================================
  # PlanProvider: Expired Trial → Graceful Downgrade to FREE
  # ============================================================================

  @unit
  Scenario: Expired trial subscription downgrades to FREE
    Given a SaaS organization
    And the organization has a trial subscription that ended in the past
    When the plan is resolved for the organization
    Then the plan type is "FREE"
    And activeTrial is false

  @unit
  Scenario: Expired trial downgrades to FREE even under infrastructure failures
    Given a SaaS organization
    And the organization has a trial subscription that ended in the past
    And the subscription cancellation will fail
    When the plan is resolved for the organization
    Then the plan type is "FREE"
    And activeTrial is false

  # ============================================================================
  # PlanProvider: Paid Subscription Takes Precedence
  # ============================================================================

  @unit
  Scenario: Paid subscription takes precedence over trial
    Given a SaaS organization
    And the organization has a paid subscription on "GROWTH_SEAT_EUR_MONTHLY"
    When the plan is resolved for the organization
    Then the plan type is "GROWTH_SEAT_EUR_MONTHLY"
    And activeTrial is false

  @unit
  Scenario: No subscription returns FREE with no trial
    Given a SaaS organization
    And the organization has no subscription
    When the plan is resolved for the organization
    Then the plan type is "FREE"
    And activeTrial is false

  @unit
  Scenario: Most recent subscription is used when multiple active exist
    Given a SaaS organization
    And the organization has an older trial subscription
    And the organization has a newer paid subscription
    When the plan is resolved for the organization
    Then the plan type is "GROWTH_SEAT_EUR_MONTHLY"
    And activeTrial is false

  @unit
  Scenario: Newer trial does not override older paid subscription
    Given a SaaS organization
    And the organization has an older paid subscription
    And the organization has a newer active trial subscription
    When the plan is resolved for the organization
    Then the plan type is "GROWTH_SEAT_EUR_MONTHLY"
    And activeTrial is false

  @unit
  Scenario: Trial subscription on non-SaaS deployment returns ENTERPRISE
    Given a non-SaaS organization
    And the organization has a trial subscription ending in the future
    When the plan is resolved for the organization
    Then the plan type is "ENTERPRISE"

  # ============================================================================
  # Upgrade Flow: Trial Stays Active Until Payment Confirmed
  # ============================================================================

  @unit
  Scenario: Trial remains active while user is in checkout
    Given a SaaS organization
    And the organization has a trial subscription ending in the future
    When the user starts a paid subscription checkout
    Then the trial subscription status is still ACTIVE

  @integration
  Scenario: Checkout completion cancels the trial subscription
    Given a SaaS organization
    And the organization has a trial subscription ending in the future
    And a Stripe checkout has completed for the organization
    When the checkout completion webhook fires
    Then the trial subscription status is set to CANCELLED

  @integration
  Scenario: Checkout completion with no trial is a no-op
    Given a SaaS organization with a paid subscription
    And a Stripe checkout has completed for the organization
    When the checkout completion webhook fires
    Then no subscriptions are cancelled

  # ============================================================================
  # UI: Trial Upgrade Block on Subscription Page
  # ============================================================================

  @integration
  Scenario: Trial user sees upgrade block on subscription page
    Given a SaaS organization on an active trial
    When the user visits the subscription page
    Then the trial upgrade block is visible
    And the upgrade block shows the trial end date
    And the upgrade block has an upgrade call-to-action

  @integration
  Scenario: Non-trial user does not see the trial upgrade block
    Given a SaaS organization with a paid subscription
    When the user visits the subscription page
    Then the trial upgrade block is not visible

  # ============================================================================
  # Dead Code Cleanup
  # ============================================================================

  @unit
  Scenario: OrganizationService.isFeatureEnabled is removed
    Given the OrganizationService class
    Then the isFeatureEnabled method does not exist

  @unit
  Scenario: isOrganizationFeatureEnabled hook is removed
    Given the useOrganizationTeamProject hook
    Then isOrganizationFeatureEnabled is not in the return value
