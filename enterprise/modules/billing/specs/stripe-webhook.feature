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
  Scenario: A checkout whose follow-up fails still grants the plan and is redelivered
    Given a paid checkout whose chosen currency or pending invites cannot be recorded
    When the webhook handles the checkout
    Then the organization is on the paid plan and its trials are cancelled
    And the delivery fails so Stripe redelivers it, and the redelivery records what was missed

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
    Given an installation configured with a payment provider and a signing secret
    When the billing application is composed
    Then connected renewals and seat changes are answered by the composed services
    And a delivery signed with that secret is acknowledged

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
  Scenario: A paid subscription asks organization to retire the trial licence
    Given an organization holding a trial licence
    When a paid subscription activates
    Then billing asks licensing to remove that organization's licence and nothing else
    And organization clears the key and both dates derived from it together

  @unit
  Scenario: A paid subscription asks licensing whether the organization still holds a trial licence
    Given a subscription activating for an organization
    When the webhook reads the activated row
    Then it asks licensing whether that organization still holds a licence
    And it removes nothing when licensing reports none

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
    Given a webhook activating, updating quantities, cancelling, linking or recording a payment failure
    When it writes through the subscription port
    Then each call reaches the repository with exactly what it was given

  @unit
  Scenario: A signed delivery is acknowledged
    Given a hosted deployment with Stripe and its webhook signing secret
    When a delivery signed with that secret arrives
    Then the delivery is acknowledged

  @unit
  Scenario: A Stripe delivery verifies alike over the provider and its memory twin
    Given the Stripe delivery channel over the provider and over its memory twin, each holding a signing secret
    When a delivery signed with that secret, one signed with another secret and one where no secret is held arrive
    Then each tier answers the first with its event and refuses the other two

  Rule: An upgrade to Growth seats never leaves the old tiered subscription billing

    Moving a legacy tiered organization to Growth seats activates the new
    subscription and cancels the old one. Stripe reports activation through two
    events in no fixed order, and either may be redelivered. So the webhook only
    records a fact: every confirmation that a Growth seat subscription is active,
    while a tiered subscription is still alive, records that it supersedes live
    tiered plans. Billing's own process manager turns each fact into one
    retirement, run through the outbox until it succeeds. The retirement reads
    Stripe before it cancels, so a retry or a second fact cancels nothing twice.

    @unit
    Scenario: A Growth seat activation records the tiered plans it supersedes
      Given an organization on a tiered plan has paid for Growth seats
      When the invoice-paid webhook is handled
      Then billing records that the seat subscription supersedes live tiered plans
      And the organization is moved to seat pricing
      And the webhook cancels nothing in Stripe itself
      And the subscription is announced as started once

    @unit
    Scenario: Recording the superseded plans fails, and Stripe's redelivery records them
      Given an organization on a tiered plan has paid for Growth seats
      And recording the superseded plans fails the first time
      When the invoice-paid webhook is handled and then redelivered
      Then the first delivery fails so Stripe redelivers it
      And the redelivery records that the seat subscription supersedes live tiered plans
      And the subscription is announced as started once

    @unit
    Scenario: The subscription update arrives before the invoice is paid
      Given an organization on a tiered plan has paid for Growth seats
      When Stripe reports the subscription active before it reports the invoice paid
      Then the update records that the seat subscription supersedes live tiered plans
      And the subscription is announced as started once

    @unit
    Scenario: An organization already billed for both plans is healed by its next payment
      Given an organization's Growth seat subscription is active
      And its old tiered subscription is still active
      When its next invoice is paid
      Then billing records that the seat subscription supersedes live tiered plans
      And no subscription is announced as started

    @unit
    Scenario: A late activation for a cancelled Growth subscription retires nothing
      Given an organization's Growth seat subscription is cancelled in our records and at Stripe
      And its tiered subscription is active
      When a delayed update reports the Growth subscription active
      Then the Growth subscription stays cancelled and nothing is announced
      And nothing is recorded for retirement

    @unit
    Scenario: An active update for a cancelled row that Stripe confirms active restores it
      Given a subscription we cancelled after a non-active update
      And Stripe now reports it active
      When the active update arrives
      Then the subscription is active again and its start is announced

    @unit
    Scenario: A renewal with nothing left to retire changes nothing
      Given an organization's Growth seat subscription is active
      And it holds no other live subscription
      When its next invoice is paid
      Then nothing is recorded for retirement and the pricing model is not announced again

    @unit
    Scenario: Each superseded-plans fact asks for one retirement
      Given billing recorded that a Growth seat subscription supersedes live tiered plans
      When the retirement process manager handles the fact, and handles it again
      Then it asks for one retirement keyed by the fact, the same key both times

    @unit
    Scenario: A retirement cancels the tiered subscription in Stripe and in our records
      Given an organization's Growth seat subscription is active
      And its tiered subscription is still active in Stripe and in our records
      When the retirement runs
      Then the tiered subscription is cancelled in Stripe with proration
      And it is cancelled in our records
      And the organization is moved to seat pricing

    @unit
    Scenario: A redelivered retirement cancels in Stripe once
      Given a retirement cancelled the tiered subscription in Stripe and then failed to record it
      When the outbox runs the retirement again
      Then the tiered subscription is cancelled in our records
      And Stripe was asked to cancel it once

    @unit
    Scenario: A tiered subscription Stripe already cancelled is not cancelled again
      Given an organization's tiered subscription is cancelled in Stripe but live in our records
      When the retirement runs
      Then Stripe is not asked to cancel it
      And it is cancelled in our records

    @unit
    Scenario: A seat subscription that is not active retires nothing
      Given an organization's Growth seat subscription is not active in our records
      And its tiered subscription is still active
      When the retirement runs
      Then nothing is cancelled in Stripe or in our records

    @unit
    Scenario: A Stripe failure fails the retirement so the outbox retries it
      Given Stripe refuses to cancel the tiered subscription
      When the retirement runs
      Then the retirement fails so the outbox retries it
      And the tiered subscription stays active in our records
      And a later run cancels it once
