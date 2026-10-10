---
name: paymentsim
description: "Run billing against paymentsim, haven's Stripe stand-in: checkout, subscriptions, invoices, signed webhooks, the test clock, payment failures and exact metered-usage totals. Use when someone says 'haven payment', 'test billing locally', 'fake Stripe', 'stripe webhook locally', 'advance the billing clock', 'fail a payment', 'replay a Stripe event', 'duplicate webhook', 'usage metering totals', 'paymentsim', 'haven sim payment', or needs to assert on a Stripe call in a test."
user-invocable: true
---

# paymentsim

Fakes exactly the Stripe surface `enterprise/modules/billing` calls, in Stripe's wire shapes
(form bodies, list/search/error envelopes, `Idempotency-Key` replay), and signs webhooks with
`Stripe-Signature: t=<unix>,v1=<hmac>` so billing's real `constructEvent` verifies them. Ids
are counters (`cus_sim000001`); catalog prices keep their real ids. Code: `services/paymentsim`;
spec: `specs/setup/payment-simulator.feature`. State is in memory: a restart forgets it.

## Run it

- Every `haven up` runs it; local and CI stacks need no Stripe account. When `.env` and the shell
  name none of `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_API_BASE`, the app gets
  `STRIPE_API_BASE=https://payment.<slug>.langwatch.localhost`, `STRIPE_SECRET_KEY=sk_test_paymentsim`,
  `STRIPE_WEBHOOK_SECRET=whsec_paymentsim`. Set your own Stripe test keys in `.env` and those are
  used as they are. `haven up` prints which: `Stripe: paymentsim` or `Stripe: your key from .env`.
- A key kept only in 1Password loses: haven sees no key, injects paymentsim's, and env answers first.
- `haven up -payment` drops the lane (sticky). Restart the API (`haven down` + `up`) after toggling.
- Without haven: `make service svc=paymentsim` with `PAYMENTSIM_ADDR` (default `:5599`),
  `PAYMENTSIM_WEBHOOK_URL`, `PAYMENTSIM_WEBHOOK_SECRET`, `PAYMENTSIM_CATALOG`, `PAYMENTSIM_PUBLIC_URL`.

## Stripe surface

customers create/retrieve/del · prices list (`expand[]=data.product`) · subscriptions
create/retrieve/update/cancel · checkout sessions create + `line_items` · billing portal
sessions · invoices create/list/search/retrieve/finalize/pay/create_preview · invoiceitems
create · billing meter_events create, meters list, `event_summaries` (minute-aligned) ·
billing credit_grants create. Anything else answers Stripe's 404 "Unrecognized request URL".

Events fired: `checkout.session.completed`, `customer.subscription.created|updated|deleted`,
`invoice.finalized|paid|payment_succeeded|payment_failed`.

## Control API (`/_sim/api`) and `haven sim payment`

| Need                          | Call                                                     | CLI                                        |
| ----------------------------- | -------------------------------------------------------- | ------------------------------------------ |
| state                         | `GET status`                                             | `haven sim payment status`                 |
| seed catalog file             | `POST catalog?mode=test` (stripe-catalog.json body)      |                                            |
| seed a (tiered) price/meter   | `POST prices` / `POST meters` (JSON)                     |                                            |
| finish a checkout             | `POST checkout/{id}/complete`, or open the session `url` |                                            |
| advance the test clock        | `POST clock/advance {"seconds"}` or `{"to"}`             | `haven sim payment advance --seconds N`    |
| decline the next charges      | `POST payment-failures {"customer","times"}`             | `haven sim payment fault --customer cus_…` |
| retry an open invoice         | `POST invoices/{id}/retry`                               |                                            |
| list events + attempts        | `GET events?type=`                                       | `haven sim payment list`                   |
| deliver ids in this order     | `POST events/deliver {"ids","signingSecret"}`            | `haven sim payment deliver --ids a,b`      |
| queue without delivering      | `POST webhooks/hold {"held":true}`                       | `haven sim payment hold` / `release`       |
| exact metered totals          | `GET usage?customer=&event_name=&from=&to=`              | `haven sim payment usage --customer …`     |
| forget everything but catalog | `DELETE state`                                           | `haven sim payment clear`                  |

Duplicate = the same id twice in `deliver`; out of order = ids reversed; bad signature =
`signingSecret` other than the configured one. The signature timestamp is the wall clock,
so Stripe's 5-minute tolerance holds after the test clock moves.

## Known gaps (it is not Stripe)

No proration (previews bill whole periods); no automatic webhook retries; unknown request
parameters are accepted; credit grants are recorded, never applied; invoice items need a
draft `invoice`. Catalog prices without a unit amount are metered on `BILLABLE_EVENTS` and
bill nothing until reseeded with tiers.
