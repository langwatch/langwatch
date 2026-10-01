Feature: Stripe webhook handling grants and removes plans correctly

  Stripe events are the only signal that an organization's plan changed. The
  webhook handler must grant, keep, or remove a plan exactly once per event,
  survive Stripe's at-least-once redelivery, and never let a side effect's
  failure stop the plan change or make Stripe retry forever.

  # billing-webhook.service.ts, billing-subscription-lifecycle.service.ts,
  # billing-checkout-completion.service.ts, subscription-item-calculator.service.ts,
  # best-effort.service.ts, api-billing-webhook.composition.ts

  @unit
  Scenario: A checkout completion grants the plan the customer paid for
    Given an organization that started a checkout for the Pro plan
    When Stripe reports the checkout as completed
    Then the organization is on the Pro plan and its pending invites are approved

  @unit
  Scenario: A Stripe event naming a subscription we do not know is ignored, not failed
    Given a Stripe event naming a subscription this installation has no record of
    When the webhook handles it
    Then no plan changes and the event is acknowledged rather than retried forever

  @unit
  Scenario: The same Stripe event delivered twice changes the plan once
    Given a subscription-updated event that has already been handled
    When Stripe redelivers the identical event
    Then the subscription is not re-applied and no second notification is sent

  @unit
  Scenario: A failed invoice payment does not immediately remove the plan
    Given an organization on a paid plan
    When Stripe reports an invoice payment failure
    Then the organization keeps its plan and is warned about the failed payment

  @unit
  Scenario: A deleted subscription returns the organization to the free plan
    Given an organization on a paid plan
    When Stripe reports the subscription as deleted
    Then the organization is on the free plan and its paid limits no longer apply

  @unit
  Scenario: A best-effort side effect that throws does not abandon the webhook
    Given a checkout completion whose analytics reporting fails
    When the webhook handles the event
    Then the plan is still granted and the failure is logged, not surfaced to Stripe

  @unit
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

  # The door itself, and the write path behind it:
  # apps/api/src/app/api-billing-webhook.composition.ts,
  # postgres.billing-webhook-subscription.adapter.ts,
  # postgres.billing-webhook-organization.adapter.ts

  @unit
  Scenario: The Stripe webhook route is declared on a deployment that bills
    Given an installation composing its API process
    When the billing webhook is composed
    Then the callback route is declared whether or not this installation bills

  @unit
  Scenario: A deployment that bills composes the real subscription services
    Given an installation configured with a payment provider
    When the billing webhook is composed
    Then checkout, the billing portal, invoices and seat changes are answered by real services

  @unit
  Scenario: A deployment with no Stripe composed answers the callback with 404
    Given an installation that bills through nobody
    When a delivery arrives at the callback
    Then it is answered as not found and no billing service is composed

  @unit
  Scenario: A delivery with no signature is refused before anything is parsed
    Given an installation configured with a payment provider
    When a delivery arrives carrying no signature
    Then it is refused in the words the provider's delivery log shows an operator

  @unit
  Scenario: The webhook resolves a Stripe customer to one organization, and to none where there is none
    Given a Stripe customer this installation has an organization for
    When the webhook resolves it
    Then it answers that organization alone, and answers nothing for a customer it does not know

  @unit
  Scenario: A checkout in a chosen currency writes that currency onto the organization
    Given a checkout completed in a currency the customer chose
    When the webhook records it
    Then only that organization's invoicing currency changes

  @unit
  Scenario: A paid subscription retires the trial licence and both dates derived from it
    Given an organization holding a trial licence
    When a paid subscription activates
    Then the licence key and both dates derived from it are cleared together

  @unit
  Scenario: An activation carries the organization's trial licence to the webhook
    Given a subscription activating for an organization
    When the webhook reads the activated row
    Then it carries whether that organization still holds a trial licence

  @unit
  Scenario: A subscription row Stripe names that is gone is not a failed delivery
    Given a Stripe delivery naming a subscription row that has been deleted
    When the webhook writes to it
    Then nothing changes and the delivery is acknowledged rather than retried forever

  @unit
  Scenario: A database failure makes Stripe retry rather than acknowledging a plan change that never landed
    Given a database that cannot be reached
    When the webhook writes a plan change
    Then the failure is raised so the delivery is retried

  @unit
  Scenario: The webhook's unrenamed subscription writes reach the repository unchanged
    Given a webhook cancelling, linking or recording a payment failure
    When it writes through the subscription port
    Then each call reaches the repository with exactly what it was given
