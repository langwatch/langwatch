Feature: paymentsim, a local stand-in for Stripe
  Billing calls Stripe for customers, prices, checkout and portal sessions,
  subscriptions, invoices, billing meters and credit grants, and Stripe calls
  billing back with signed webhooks. paymentsim fakes exactly that surface in
  Stripe's own wire shapes (form-encoded requests, list and error envelopes,
  Idempotency-Key replay, Stripe-Signature t=,v1=), seeds the billing catalog
  under its real price ids, and gives tests a control API: seed prices and
  tiers, advance a test clock, decline charges, deliver events in any order or
  twice or with the wrong secret, and read metered usage back as exact totals.
  It checks no credential beyond its presence: it is a dev shim.

  # Bound by Go tests in services/paymentsim, tools/thuishaven/domain and
  # cmd/service. Billing's own handling of these deliveries is bound in
  # enterprise/modules/billing; the rows against paymentsim are bound in billing-process's
  # billing-paymentsim.integration.test.ts, which skips where no Go toolchain is present.

  Rule: Stripe's API surface

    @unit
    Scenario: A call without an API key is refused as Stripe refuses it
      When a client calls /v1/prices with no Authorization header
      Then paymentsim answers 401 with Stripe's invalid_request_error envelope

    @unit
    Scenario: The catalog seeds the product's own price ids
      Given paymentsim started with the billing contract's stripe-catalog.json
      When billing lists prices with the product expanded and lists meters
      Then it gets the test-mode price ids, amounts and currencies the catalog maps
      And the billable-events meter under its catalog id

    @unit
    Scenario: An unknown id answers Stripe's resource_missing error
      When billing retrieves a subscription paymentsim does not hold
      Then paymentsim answers 404 with code resource_missing

    @unit
    Scenario: An idempotent retry replays the first answer
      When billing creates a customer twice with the same Idempotency-Key and parameters
      Then both answers name the same customer

    @unit
    Scenario: Reusing an idempotency key with other parameters is refused
      When a request reuses an Idempotency-Key with different parameters
      Then paymentsim answers 400 with an idempotency_error

    @unit
    Scenario: A checkout session completes into an active subscription
      Given a checkout session for seats and the metered events price
      When the session is completed through the control API
      Then the subscription is active with the seat quantity and a metered item without one
      And checkout.session.completed, customer.subscription.created, invoice.finalized, invoice.paid and invoice.payment_succeeded fire in that order

    @unit
    Scenario: Tiered prices bill graduated and volume tiers
      Given a tiered price with a capped first tier and an open second tier with a flat fee
      Then a graduated price bills each band at its own rate
      And a volume price bills every unit at the band the total falls in

  Rule: Webhooks are signed and replayable

    @unit
    Scenario: Every event is delivered signed in Stripe's format
      When paymentsim delivers events to the configured endpoint
      Then each carries a Stripe-Signature of t=<unix>,v1=<HMAC-SHA256> that Stripe's verification accepts

    @unit
    Scenario: A delivery signed with the wrong secret is refused by Stripe's verification
      When an event is delivered signed with another secret
      Then the endpoint answers 400 and the attempt records it

    @unit
    Scenario: A duplicate delivery carries the identical event
      When the same event id is delivered twice
      Then the endpoint receives the same id and the same data.object both times

    @unit
    Scenario: Held events are delivered out of order on request
      Given webhooks are held
      When a checkout completes and its events are delivered newest first
      Then the endpoint receives them in that order and none stays queued

  Rule: The test clock and payments

    @unit
    Scenario: Advancing the clock renews a subscription and bills its metered usage
      Given a subscription with two seats and tiered metered events
      When the clock moves past the period end
      Then a subscription_cycle invoice bills the seats and the usage above the free tier, and is paid

    @unit
    Scenario: A forced payment failure fires invoice.payment_failed and marks the subscription past due
      Given the customer's next charge is set to fail
      When the clock moves past the period end
      Then invoice.payment_failed fires and the subscription is past_due

    @unit
    Scenario: A retried invoice pays and restores the subscription
      Given a past_due subscription with an open invoice
      When the invoice is retried through the control API
      Then the invoice is paid on its second attempt and the subscription is active

    @unit
    Scenario: Cancel at period end ends the subscription when the clock passes it
      Given a subscription set to cancel at period end
      When the clock moves past the period end
      Then the subscription is canceled and customer.subscription.deleted fires

  Rule: Usage metering

    @unit
    Scenario: Meter events total exactly per customer
      When billing sends meter events for a customer
      Then the control API's usage totals give their exact sum and count

    @unit
    Scenario: A repeated meter event identifier is refused
      When a meter event reuses an identifier
      Then paymentsim answers 400 with code resource_already_exists

    @unit
    Scenario: Event summaries need minute-aligned windows
      When billing asks for an event summary over a window that is not minute-aligned
      Then paymentsim answers 400
      And an aligned window answers the aggregated value

  Rule: haven runs it

    @unit
    Scenario: haven points billing at paymentsim only when no Stripe credential is set
      Given `haven up +payment` and an .env without STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET or STRIPE_API_BASE
      Then the app gets STRIPE_API_BASE at paymentsim and the paymentsim key and signing secret
      And a developer's own Stripe setting is never rewired

    @unit
    Scenario: A dev build hosts paymentsim in the combined process
      Then `service combined` and `service paymentsim` both run it

  Rule: Billing against paymentsim

    @integration
    Scenario: Billing refuses a delivery with a bad signature
      Given the stack runs with paymentsim
      When paymentsim delivers an event signed with the wrong secret
      Then /api/webhooks/stripe answers 400 and nothing changes

    @integration
    Scenario: A duplicate Stripe event leaves the subscription unchanged
      Given a completed checkout whose events were delivered
      When checkout.session.completed is delivered again
      Then the organization's subscription is unchanged

    @integration
    Scenario: Events out of order still activate the subscription
      When a checkout's invoice events arrive before checkout.session.completed
      Then the subscription ends ACTIVE

    @integration
    Scenario: A failed renewal payment is recorded
      When paymentsim declines a renewal charge
      Then billing records the payment failure on the subscription

    @integration
    Scenario: Reported usage reaches the meter exactly once
      When the usage reporting run sends a month's billable events
      Then paymentsim's usage total equals the events counted and a rerun adds nothing
