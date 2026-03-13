Feature: Stripe webhook billing event handling
  The billing system processes Stripe webhook events to keep subscription
  state, organization settings, and payment records consistent. Each event
  handler waits for Stripe eventual consistency before querying the database,
  and all state changes are persisted through dedicated repository abstractions.

  # --- Checkout completed ---

  @unit
  Scenario: Successful checkout links and activates the subscription
    Given a pending subscription matching the checkout reference
    When the checkout completed event arrives with a Stripe subscription ID and currency
    Then the Stripe subscription is linked to the pending subscription
    And the subscription is activated
    And the selected currency is persisted on the organization
    And pending payment invites are approved
    And active trial subscriptions for the organization are cancelled

  @unit
  Scenario: Checkout without a reference ID is ignored
    Given a checkout event with no client reference ID
    When the checkout completed event arrives
    Then the event is ignored without modifying any subscription state

  @unit
  Scenario: Checkout fails when no subscription matches the reference
    Given a checkout reference that matches no existing subscription
    When the checkout completed event arrives
    Then the system reports a missing subscription error

  @unit
  Scenario: Checkout succeeds even when currency persistence fails
    Given a pending subscription matching the checkout reference
    And persisting the selected currency will fail
    When the checkout completed event arrives
    Then the subscription is still activated
    And trial subscriptions are still cancelled

  @unit
  Scenario: Checkout succeeds even when invite approval fails
    Given a pending subscription matching the checkout reference
    And approving pending invites will fail
    When the checkout completed event arrives
    Then the subscription is still activated
    And trial subscriptions are still cancelled

  @unit
  Scenario: Checkout succeeds without an invite approval mechanism
    Given a pending subscription matching the checkout reference
    And no invite approval mechanism is configured
    When the checkout completed event arrives
    Then the subscription is activated without attempting invite approval

  # --- Invoice payment succeeded ---

  @unit
  Scenario: First successful payment activates the subscription and clears a trial license
    Given a subscription that has not yet been activated
    And the organization has a trial license
    When the invoice payment succeeded event arrives
    Then the subscription is activated
    And the trial license is cleared on the organization
    And a subscription confirmed notification is sent

  @unit
  Scenario: Subsequent payment renewals do not re-notify
    Given a subscription that is already active
    When the invoice payment succeeded event arrives
    Then the subscription start date is not changed
    And no notification is sent

  @unit
  Scenario: Upgrade to a seat-event plan migrates old subscriptions
    Given a subscription on a seat-event plan that has not yet been activated
    When the invoice payment succeeded event arrives
    Then old tiered subscriptions are migrated atomically
    And the corresponding Stripe subscriptions are cancelled with proration
    And failures to cancel old Stripe subscriptions are logged but do not block the handler

  # --- Invoice payment failed ---

  @unit
  Scenario: Payment failure on an active subscription records the failure
    Given a subscription that is currently active
    When the invoice payment failed event arrives
    Then the payment failure is recorded
    And the subscription remains active

  @unit
  Scenario: Payment failure on a pending subscription marks it as failed
    Given a subscription that is currently pending
    When the invoice payment failed event arrives
    Then the subscription status is set to failed
    And the payment failure date is recorded

  # --- Subscription deleted ---

  @unit
  Scenario: Subscription deletion cancels the subscription
    Given a subscription that is not already cancelled
    When the subscription deleted event arrives
    Then the system waits for Stripe eventual consistency
    And the subscription is cancelled

  @unit
  Scenario: Subscription deletion is idempotent
    Given a subscription that is already cancelled
    When the subscription deleted event arrives
    Then no state change occurs

  # --- Subscription updated ---

  @unit
  Scenario: Subscription marked inactive or ended is cancelled
    Given a subscription where the Stripe status is not active
    When the subscription updated event arrives
    Then the subscription is cancelled

  @unit
  Scenario: Subscription with ended_at is cancelled even if status is active
    Given a subscription where the Stripe object has ended_at set
    When the subscription updated event arrives
    Then the subscription is cancelled

  @unit
  Scenario: Scheduled cancellation does not cancel immediately
    Given a subscription where canceled_at is set but ended_at is null and status is active
    When the subscription updated event arrives
    Then the subscription is NOT cancelled
    And quantities are updated as normal

  @unit
  Scenario: Active subscription recalculates quantities from Stripe items
    Given a subscription that is currently active
    When the subscription updated event arrives with changed item quantities
    Then member and trace quantities are recalculated from the Stripe items
    And the subscription quantities are persisted

  @unit
  Scenario: Active subscription update clears a trial license
    Given a subscription that is currently active
    And the organization has a trial license
    When the subscription updated event arrives with Stripe status active
    Then the trial license is cleared on the organization

  @unit
  Scenario: Transition to active triggers a notification
    Given a subscription that was not previously active
    When the subscription updated event arrives with Stripe status active
    Then a subscription confirmed notification is sent

  @unit
  Scenario: Already-active subscription does not re-notify
    Given a subscription that is already active
    When the subscription updated event arrives with Stripe status active
    Then no notification is sent

  # --- Shared skip behavior ---

  @unit
  Scenario Outline: Unrecognized subscription ID is ignored by <handler>
    Given no subscription matches the Stripe subscription ID
    When the <handler> event arrives
    Then no state change occurs

    Examples:
      | handler                       |
      | invoice payment succeeded     |
      | invoice payment failed        |
      | subscription deleted          |
      | subscription updated          |
