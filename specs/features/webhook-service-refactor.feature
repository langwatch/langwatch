Feature: Webhook service refactor
  The EEWebhookService class replaces the existing createWebhookService
  factory. All five webhook handlers retain identical behavior but delegate
  database access through SubscriptionRepository and OrganizationRepository
  instead of calling Prisma directly. The old factory is removed entirely.

  # --- Interface compliance ---

  @unit
  Scenario: New class implements the WebhookService interface
    Given the WebhookService interface in the billing layer
    When EEWebhookService.create() is called with repository and Stripe dependencies
    Then it returns an object satisfying the WebhookService interface

  # --- handleCheckoutCompleted ---

  @unit
  Scenario: handleCheckoutCompleted strips subscription_setup_ prefix and links Stripe subscription
    Given a pending subscription with client reference ID "subscription_setup_sub_db_1"
    When handleCheckoutCompleted is called with a Stripe subscription ID and currency
    Then the Stripe subscription ID is linked to subscription "sub_db_1"
    And the subscription is activated
    And the selected currency is persisted on the organization
    And pending payment invites are approved
    And active trial subscriptions for the organization are cancelled

  @unit
  Scenario: handleCheckoutCompleted returns early when client reference ID is missing
    Given no client reference ID in the checkout event
    When handleCheckoutCompleted is called
    Then it returns earlyReturn true without touching any repository

  @unit
  Scenario: handleCheckoutCompleted throws when no subscription matches
    Given a client reference ID that matches no subscription record
    When handleCheckoutCompleted is called
    Then SubscriptionRecordNotFoundError is thrown

  @unit
  Scenario: handleCheckoutCompleted continues when currency update fails
    Given a pending subscription with a matching client reference ID
    And the currency update will fail
    When handleCheckoutCompleted is called
    Then the subscription is still activated
    And trial subscriptions are still cancelled

  @unit
  Scenario: handleCheckoutCompleted continues when invite approval fails
    Given a pending subscription with a matching client reference ID
    And the invite approver will fail
    When handleCheckoutCompleted is called
    Then the subscription is still activated
    And trial subscriptions are still cancelled

  @unit
  Scenario: handleCheckoutCompleted completes without invite approver
    Given a pending subscription with a matching client reference ID
    And no invite approver is configured
    When handleCheckoutCompleted is called
    Then the subscription is activated without attempting invite approval

  # --- handleInvoicePaymentSucceeded ---

  @unit
  Scenario: handleInvoicePaymentSucceeded activates and clears trial license
    Given a subscription matched by Stripe subscription ID that was not previously active
    When handleInvoicePaymentSucceeded is called
    Then the subscription is activated
    And the trial license is cleared on the organization
    And a subscription confirmed notification is dispatched

  @unit
  Scenario: handleInvoicePaymentSucceeded sets startDate only on first activation
    Given a subscription matched by Stripe subscription ID that is already active
    When handleInvoicePaymentSucceeded is called
    Then the subscription startDate is not changed
    And no notification is dispatched

  @unit
  Scenario: handleInvoicePaymentSucceeded migrates tiered subscriptions during upgrade
    Given a subscription on a growth seat-event plan that was not previously active
    When handleInvoicePaymentSucceeded is called
    Then old tiered subscriptions and pricing model are migrated atomically
    And the old Stripe subscriptions are cancelled with proration by the service
    And Stripe cancellation failures are logged but do not fail the handler

  # --- handleInvoicePaymentFailed ---

  @unit
  Scenario: handleInvoicePaymentFailed records failure but keeps active status
    Given a subscription that is currently active
    When handleInvoicePaymentFailed is called
    Then the payment failure is recorded
    And the subscription status remains ACTIVE

  @unit
  Scenario: handleInvoicePaymentFailed sets FAILED status for pending subscription
    Given a subscription that is currently pending
    When handleInvoicePaymentFailed is called
    Then the subscription status is set to FAILED
    And the payment failure date is recorded

  # --- handleSubscriptionDeleted ---

  @unit
  Scenario: handleSubscriptionDeleted cancels and nullifies overrides
    Given a subscription matched by Stripe subscription ID that is not already cancelled
    When handleSubscriptionDeleted is called
    Then the subscription is cancelled with nullified overrides

  @unit
  Scenario: handleSubscriptionDeleted is idempotent for already cancelled subscriptions
    Given a subscription that is already cancelled
    When handleSubscriptionDeleted is called
    Then no repository update is performed

  # --- handleSubscriptionUpdated ---

  @unit
  Scenario: handleSubscriptionUpdated cancels when Stripe status is not active
    Given a subscription where the Stripe status is not active
    When handleSubscriptionUpdated is called
    Then the subscription is cancelled with nullified overrides

  @unit
  Scenario: handleSubscriptionUpdated cancels when Stripe reports ended
    Given a subscription where the Stripe object has ended_at set
    When handleSubscriptionUpdated is called
    Then the subscription is cancelled with nullified overrides

  @unit
  Scenario: handleSubscriptionUpdated does NOT cancel when only canceled_at is set
    Given a subscription where the Stripe status is active and canceled_at is set but ended_at is null
    When handleSubscriptionUpdated is called
    Then the subscription is NOT cancelled
    And quantities are updated as normal

  @unit
  Scenario: handleSubscriptionUpdated recalculates quantities when active
    Given a subscription where the Stripe status is active
    When handleSubscriptionUpdated is called with updated item quantities
    Then member and trace quantities are recalculated from the updated Stripe items
    And the subscription quantities are updated
    And the trial license is cleared on the organization

  @unit
  Scenario: handleSubscriptionUpdated notifies on status transition to active
    Given a subscription that was not previously active
    When handleSubscriptionUpdated is called with Stripe status active
    Then a subscription confirmed notification is dispatched

  @unit
  Scenario: handleSubscriptionUpdated does NOT re-notify when already active
    Given a subscription that is already active
    When handleSubscriptionUpdated is called with Stripe status active
    Then no notification is dispatched

  # --- Shared skip behavior ---

  @unit
  Scenario Outline: <handler> skips when no subscription found
    Given no subscription matches the Stripe subscription ID
    When <handler> is called
    Then no repository update is performed

    Examples:
      | handler                        |
      | handleInvoicePaymentSucceeded  |
      | handleInvoicePaymentFailed     |
      | handleSubscriptionDeleted      |
      | handleSubscriptionUpdated      |
