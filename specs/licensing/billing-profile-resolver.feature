Feature: Billing profile resolution in the composite plan provider
  # ADR-039 rollout step 2. The composite plan provider computes the billing
  # block (meterUnit, memberPolicy, showUsageLimits, isLegacyTiered) and
  # capabilities from the winning plan source. The pricingModel column is
  # self-healed cache, never an input. Precedence-rank scenarios live in
  # precedence-flag-flip.feature (they ship behind the flag).

  As the platform
  I want one resolver to answer how an organization pays and what it can access
  So that no surface re-derives billing behavior from raw stored signals

  # --- Active subscription predicate ---

  @unit
  Scenario: A PENDING subscription does not win plan resolution
    Given an organization whose only subscription has status "PENDING"
    When the active plan is resolved
    Then the plan resolves as if no subscription exists

  @unit
  Scenario: A FAILED subscription does not win plan resolution
    Given an organization whose only subscription has status "FAILED"
    When the active plan is resolved
    Then the plan resolves as if no subscription exists

  # --- memberPolicy mapping (Decision 4) ---

  @unit
  Scenario: Seat-event subscription resolves member policy purchase_seat
    Given an organization whose winning plan source is an ACTIVE "GROWTH_SEAT_USD_MONTHLY" subscription
    When the active plan is resolved
    Then the billing profile member policy is "purchase_seat"

  @unit
  Scenario: ENTERPRISE license resolves member policy hard_cap
    Given a SaaS organization whose winning plan source is a valid ENTERPRISE license
    When the active plan is resolved
    Then the billing profile member policy is "hard_cap"

  @unit
  Scenario: Non-ENTERPRISE license on SaaS resolves member policy upgrade
    Given a SaaS organization whose winning plan source is a valid GROWTH license
    When the active plan is resolved
    Then the billing profile member policy is "upgrade"

  @unit
  Scenario: Any license on self-hosted resolves member policy hard_cap
    Given a self-hosted deployment whose organization has a valid GROWTH license
    When the active plan is resolved
    Then the billing profile member policy is "hard_cap"

  @unit
  Scenario: Legacy tiered paid subscription resolves member policy upgrade
    Given an organization whose winning plan source is an ACTIVE "LAUNCH" subscription
    When the active plan is resolved
    Then the billing profile member policy is "upgrade"

  @unit
  Scenario: Free organization resolves member policy upgrade
    Given an organization with no subscription and no license
    When the active plan is resolved
    Then the billing profile member policy is "upgrade"

  # --- Capabilities (Decision 6) ---

  @unit
  Scenario: Enterprise plan resolves with enterprise capabilities enabled
    Given an organization whose winning plan is ENTERPRISE
    When the active plan is resolved
    Then the plan capabilities include rbac, scim, and sso as enabled

  @unit
  Scenario: Growth plan resolves with enterprise capabilities disabled
    Given an organization whose winning plan source is an ACTIVE "GROWTH_SEAT_EUR_MONTHLY" subscription
    When the active plan is resolved
    Then the plan capabilities report rbac as disabled

  # --- Self-heal (Decision 3) ---

  @unit
  Scenario: Resolving a drifted organization heals the pricingModel column
    Given an organization with pricingModel "TIERED" and an ACTIVE seat-event subscription
    When the active plan is resolved
    Then the organization's pricingModel is updated to "SEAT_EVENT"

  @unit
  Scenario: The self-heal fires at most once per guard window
    Given an organization whose pricingModel was healed within the guard window
    When the active plan is resolved again
    Then no additional pricingModel update is issued

  @unit
  Scenario: A heal invalidates the organization's meter decision cache
    Given an organization with a cached meter decision based on the stale column
    When the resolver heals the organization's pricingModel
    Then the next meter decision is recomputed from the resolved plan

  # --- Trial licenses (Decision 8) ---

  @unit
  Scenario: Subscription activation clears a trial license
    Given an organization holding a license marked as trial
    When a Stripe subscription activates for the organization
    Then the trial license is removed

  @unit
  Scenario: Subscription activation preserves a non-trial license and alerts ops
    Given an organization holding a license not marked as trial
    When a Stripe subscription activates for the organization
    Then the license remains stored
    And an ops alert reports the license and subscription conflict

  # --- Orphaned subscription (Decision 11) ---

  @unit
  Scenario: An ENTERPRISE license winning over an active subscription alerts without touching the subscription
    Given an organization with a valid ENTERPRISE license and an ACTIVE seat-event subscription
    When the active plan is resolved
    Then an ops alert reports the coexisting paid subscription
    And the Stripe subscription is not modified or cancelled

  # --- OSS parity (Invariant I5) ---

  @unit
  Scenario: Self-hosted resolution behavior is unchanged
    Given a self-hosted deployment with a valid ENTERPRISE license
    When the active plan is resolved
    Then the plan matches the license exactly as before the resolver change
