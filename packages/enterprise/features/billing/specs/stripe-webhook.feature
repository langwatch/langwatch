Feature: Stripe webhook handling grants and removes plans correctly

  Stripe events are the only signal that an organization's plan changed. The
  webhook handler must grant, keep, or remove a plan exactly once per event,
  survive Stripe's at-least-once redelivery, and never let a side effect's
  failure stop the plan change or make Stripe retry forever.

  # billing-webhook.service.ts, billing-subscription-lifecycle.service.ts,
  # billing-checkout-completion.service.ts, subscription-item-calculator.service.ts,
  # best-effort.service.ts

  @unit @unimplemented
  Scenario: A checkout completion grants the plan the customer paid for
    Given an organization that started a checkout for the Pro plan
    When Stripe reports the checkout as completed
    Then the organization is on the Pro plan and its pending invites are approved

  @unit @unimplemented
  Scenario: A Stripe event for an unknown customer is ignored, not failed
    Given a Stripe event whose customer matches no organization
    When the webhook handles it
    Then no plan changes and the event is acknowledged rather than retried forever

  @unit @unimplemented
  Scenario: The same Stripe event delivered twice changes the plan once
    Given a subscription-updated event that has already been handled
    When Stripe redelivers the identical event
    Then the subscription is not re-applied and no second notification is sent

  @unit @unimplemented
  Scenario: A failed invoice payment does not immediately remove the plan
    Given an organization on a paid plan
    When Stripe reports an invoice payment failure
    Then the organization keeps its plan and is warned about the failed payment

  @unit @unimplemented
  Scenario: A deleted subscription returns the organization to the free plan
    Given an organization on a paid plan
    When Stripe reports the subscription as deleted
    Then the organization is on the free plan and its paid limits no longer apply

  @unit @unimplemented
  Scenario: A best-effort side effect that throws does not abandon the webhook
    Given a checkout completion whose analytics reporting fails
    When the webhook handles the event
    Then the plan is still granted and the failure is logged, not surfaced to Stripe

  @unit @unimplemented
  Scenario: A subscription update recalculates the quantity for every priced item
    Given a subscription carrying seat and usage prices
    When Stripe reports the subscription as updated
    Then each item's quantity matches what the calculator derives for its price

  @unit
  Scenario: A licence checkout links what the issued tier unlocks
    Given a licence checkout for a tier sold on the self-serve ladder
    When the licence purchase is handled
    Then the licence mail carries a self-serve unlocked-features link

  @unit
  Scenario: A licence checkout for a negotiated tier names the account team
    Given a licence checkout for a tier resolved as account-managed
    When the licence purchase is handled
    Then the licence mail names the account team and links no plan page

  @unit
  Scenario: A licence checkout with no catalogue composed sends without the link
    Given a licence checkout on a deployment that composed no catalogue resolver
    When the licence purchase is handled
    Then the licence mail sends without unlocked features
