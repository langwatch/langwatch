Feature: Seat subscription provisions an organization retention policy

  When an organization starts paying for a Growth Seat subscription, the
  platform records its data-retention entitlement as an explicit
  organization-scoped policy, and removes that policy once the organization
  no longer has any active subscription.

  # Retention is default-on (ADR-021): with no override anywhere in a project's
  # scope cascade, every category resolves to the platform default window
  # (49 days / 7 weeks). A paid Growth Seat subscription stamps that same window
  # as an explicit organization-scoped override for every category (traces,
  # scenarios, experiments — evaluation runs live under traces, simulation runs
  # under scenarios), so the entitlement is recorded rather than implied — it
  # survives any future lowering of the platform default that an org without an
  # override would otherwise drift down to. Provisioning is idempotent (one
  # override per scope + category) and is a best-effort side effect: a retention
  # failure is logged, never raised, so it can never fail the Stripe webhook and
  # leave the subscription stuck PENDING.

  Background:
    Given an organization with no retention override

  @unit
  Scenario: A first paid Growth Seat activation provisions the organization policies
    Given a pending Growth Seat subscription for the organization
    When the subscription is activated by a successful payment
    Then an organization-scoped retention policy is set to the platform default for every category

  @unit
  Scenario: A renewal does not re-provision the policy
    Given an already-active Growth Seat subscription for the organization
    When a renewal payment succeeds
    Then no retention policy is provisioned

  @unit
  Scenario: A non-seat plan does not provision a policy
    Given a pending non-seat paid subscription for the organization
    When the subscription is activated by a successful payment
    Then no retention policy is provisioned

  @unit
  Scenario: A retention failure never fails the billing webhook
    Given a pending Growth Seat subscription for the organization
    And provisioning the retention policy will fail
    When the subscription is activated by a successful payment
    Then the activation still completes and the confirmation notification is sent

  # Removal-on-cancellation is deactivated until the paid-retention
  # feature is released. Cancelling currently leaves the policies in place.
  @unit
  Scenario: Cancelling a subscription leaves the retention policies in place
    Given an organization whose only active subscription is cancelled
    When the cancellation is finalized
    Then the organization-scoped retention policies are left in place
