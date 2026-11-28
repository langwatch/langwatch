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

  # Bound by Go tests in services/sims/paymentsim, tools/thuishaven/domain and
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
    Scenario: Each dollar usage price is metered on its own meter
      Given a catalog mapping the Instant Evals and PII redaction prices at 100 cents per dollar, and their meters
      When paymentsim seeds it
      Then the Instant Evals price is metered on the Instant Evals meter
      And the PII redaction price is metered on the PII redaction meter

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
    Scenario: An open checkout session is listed and expired as Stripe does
      Given a customer with two open checkout sessions
      When the customer's open sessions are listed and one is expired
      Then the list answers both, newest first, and the expired one no longer shows as open
      And the expiry is announced as checkout.session.expired
      And expiring it again is refused, as is completing it

    @unit
    Scenario: A paid invoice's payment is refunded as Stripe refunds it
      Given a subscription whose first invoice was paid
      When its payment is refunded by payment intent or by charge
      Then the refund succeeds for the amount paid and fires refund.created
      And the control API and haven sim payment refunds list it against the invoice
      And refunding it again is refused with charge_already_refunded

    @unit
    Scenario: A payment-link checkout carries the link and the buyer's details
      Given a checkout session created with a payment link and the buyer's email
      When the session is completed through the control API with the buyer's name
      Then checkout.session.completed names the payment link
      And its customer_details carry the buyer's email and name

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
    Scenario: A renewal bills the dollars judged on the catalog's Instant Evals price
      Given paymentsim started with the billing contract's stripe-catalog.json
      And a dollar subscription with two seats and the catalog's Instant Evals price
      When 1.2345 dollars are sent to the Instant Evals meter and the clock moves past the period end
      Then the renewal invoice bills the seats and 123 cents for Instant Evals

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

  Rule: Pending updates hold a seat change until it is paid

    @unit
    Scenario: A pending_if_incomplete seat change that pays applies at once
      Given a subscription with two seats
      When billing asks for three seats with proration_behavior always_invoice, payment_behavior pending_if_incomplete and latest_invoice expanded
      Then the subscription has three seats and no pending_update
      And latest_invoice is the paid proration invoice with its hosted_invoice_url, and the id when not expanded

    @unit
    Scenario: The default payment_behavior applies a declined seat change as before
      Given a subscription with two seats and the customer's next charge set to fail
      When billing asks for three seats with proration_behavior always_invoice and no payment_behavior
      Then the subscription has three seats and is past_due

    @unit
    Scenario: A declined pending_if_incomplete change keeps the items and holds a pending update
      Given a subscription with two seats and the customer's next charge set to fail
      When billing asks for three seats with payment_behavior pending_if_incomplete
      Then the subscription keeps two seats, stays active and holds a pending_update for three seats expiring in 23 hours
      And latest_invoice is open, attempted and carries its hosted_invoice_url
      And invoice.finalized, invoice.payment_failed and customer.subscription.updated fire in that order

    @unit
    Scenario: A charge needing customer action fires invoice.payment_action_required
      Given the customer's next charge is set to need customer action
      When billing asks for three seats with payment_behavior pending_if_incomplete
      Then invoice.payment_failed and invoice.payment_action_required fire and the pending_update is held

    @unit
    Scenario: Paying the held invoice applies the pending update once
      Given a held pending update for three seats
      When billing pays its invoice
      Then the subscription has three seats and no pending_update
      And customer.subscription.updated, invoice.paid and invoice.payment_succeeded fire in that order
      And paying it again answers invoice_already_paid and fires nothing

    @unit
    Scenario: The hosted invoice page pays an open invoice
      Given a held pending update whose invoice needs customer action
      When the customer opens its hosted_invoice_url and presses Pay
      Then the page shows Paid and the subscription has the new seats

    @unit
    Scenario: A control retry of the held invoice applies the pending update
      Given a held pending update for four seats
      When the invoice is retried through the control API
      Then the invoice is paid and the subscription has four seats

    @unit
    Scenario: An expired pending update is discarded and its invoice voided
      Given a held pending update
      When the clock moves 24 hours on
      Then customer.subscription.updated and invoice.voided fire, the seats are unchanged and the invoice is void
      And paying the void invoice is refused

    @unit
    Scenario: Voiding the held invoice discards its pending update
      Given a held pending update for three seats
      When billing voids its invoice
      Then the subscription keeps two seats with no pending_update and the invoice is void
      And paying the void invoice is refused

    @unit
    Scenario: A pending update that expires unpaid takes the usage it billed with it
      Given a subscription with two seats and 1500 metered events this period
      And the customer's next charge needs their action
      When a pending_if_incomplete change to three seats is held
      Then the pending update invoice bills the events used so far
      And after it expires unpaid the renewal bills the seats and no events

    @unit
    Scenario: An invoice of its own with auto_advance off waits for pay and keeps the cycle's usage
      Given a subscription with two seats and 1500 metered events this period
      And the customer's next charge needs their action
      When an invoice with auto_advance off and one invoice item is finalized
      Then it stays open with no charge attempted, and pay answers that the customer must act
      And after it is voided the renewal still bills the seats and the events

  Rule: Usage metering

    @unit
    Scenario: Meter events total exactly per customer
      When billing sends meter events for a customer
      Then the control API's usage totals give their exact sum and count

    @unit
    Scenario: A meter event value may be a decimal, as in Stripe
      When billing sends meter events of 0.0001 and 1.1233 for a customer
      Then the control API's usage total and the event summary give exactly 1.1234

    @unit
    Scenario: A meter event value that is not a number is refused
      When a meter event carries the value "0,0001"
      Then paymentsim answers 400 saying the value must be a number

    @unit
    Scenario: Decimal usage on a per-unit price bills to the cent
      Given a metered price of 100 cents per unit
      When the period's usage totals 1.1234 units
      Then the renewal invoice line for that price is 112 cents

    @unit
    Scenario: Half a cent of decimal usage rounds up
      Given a metered price of 100 cents per unit
      When the period's usage totals 1.005 units
      Then the line for that price is 101 cents, never 100

    @unit
    Scenario: A repeated meter event identifier is refused
      When a meter event reuses an identifier
      Then paymentsim answers 400 with code resource_already_exists

    @unit
    Scenario: Event summaries need minute-aligned windows
      When billing asks for an event summary over a window that is not minute-aligned
      Then paymentsim answers 400
      And an aligned window answers the aggregated value

  Rule: Console

    @unit
    Scenario: The control API lists what paymentsim holds
      Given a completed checkout
      When a reader lists /_sim/api/customers, subscriptions, checkout and invoices
      Then it gets each object newest first
      And an unknown /_sim/api path is a 404 and the Stripe paths keep answering

    @unit
    Scenario: The console is served at the root
      When a browser opens paymentsim's root
      Then it gets the console page, or the page naming the build command when the bundle is missing

    @integration
    Scenario: The console shows customers, subscriptions, checkout sessions, invoices and webhook events
      Given a completed checkout whose events were delivered
      When the console is open
      Then it lists customers, subscriptions with plan and status, checkout sessions and invoices
      And it lists the webhook events sent to the app with their delivery status

  Rule: haven runs it

    @unit
    Scenario: haven points billing at paymentsim only when no Stripe credential is set
      Given `haven up` and an .env without STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET or STRIPE_API_BASE
      Then the app gets STRIPE_API_BASE at paymentsim and the paymentsim key and signing secret
      And a developer's own Stripe setting is never rewired

    @unit
    Scenario: Every haven stack runs paymentsim unless the worktree turned it off
      Given a worktree whose selection file predates paymentsim being on by default
      When `haven up` reads it
      Then paymentsim runs
      And `haven up -payment` still turns it off and is remembered

    @unit
    Scenario: haven up says which Stripe billing talks to
      When `haven up` starts a stack
      Then it prints "Stripe: paymentsim", "Stripe: your test key from .env" when a Stripe key is set, or "Stripe: custom base <url>" when STRIPE_API_BASE is set

    @unit
    Scenario: haven refuses a live Stripe key
      Given STRIPE_SECRET_KEY in .env or the shell starts with sk_live_ or rk_live_
      When `haven up` runs
      Then it refuses to start the stack and names STRIPE_SECRET_KEY without printing its value
      And it says to use a test key (sk_test_) or remove it to get paymentsim

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

    @integration
    Scenario: A seat change previewed with always_invoice bills exactly what the preview showed
      Given a subscription with two seats half way through its period
      When a preview of four seats with proration_behavior always_invoice is taken and the same change is then applied
      Then the preview's amount due is the prorated credit and charge and the change creates one paid invoice for that amount