# ADR-002: Failed payment recovery lives on the subscription row

**Date:** 2026-11-09

**Status:** Accepted

## Context

A renewal charge that fails leaves the customer on the paid plan with no signal. Stripe retries on
its own schedule, and before this change:

- `invoice.payment_failed` only stamped `Subscription.lastPaymentFailedDate` and kept the row
  `ACTIVE` (`billing-stripe-webhook.service.ts` `handleInvoicePaymentFailed`). No email, no banner.
- `customer.subscription.updated` treated every status other than `active` as cancelled
  (`billing-subscription-lifecycle.service.ts` `handleSubscriptionUpdated`), so a `past_due` update
  cancelled the row and nulled its custom limits on the first failed charge, wherever Stripe sends
  that event.
- The plan resolves from the newest `ACTIVE` row (`plan-provider.service.ts` `getActivePlan`).

## Decision

Billing owns recovery. The state is four nullable columns on `Subscription`:
`paymentRecoveryInvoiceId`, `paymentRecoveryStartedAt` (day 0), `paymentRecoveryNoticeDay` (the last
notice sent: 0, 3, 7, 14 or 21) and `paymentRecoveryClosedAt`.

```
none --charge fails--> failing(day 0) --day 3/7/14 notices--> failing --day 21--> paused
failing|paused --invoice paid--> none (received or restored email)
failing|paused --voided, uncollectible, deleted--> none (no email)
```

- **Opening.** The first failed charge of a renewal invoice on an `ACTIVE`, card-collected,
  non-Enterprise subscription opens the case with a conditional write; only the write that opens it
  sends the day 0 email. Later retries of the same invoice keep day 0.
- **Paused is derived, never stored.** `getActivePlan` answers Free limits once
  `paymentRecoveryStartedAt + 21 days` has passed and the case is open, so access stops on time even
  when the sweep is late. Nothing is deleted; limits only refuse new additions.
- **Notices.** A scheduled process manager on billing's pipeline wakes hourly, finds open cases and
  sends the latest notice due, advancing `paymentRecoveryNoticeDay` with a compare-and-set, so two
  sweeps or a missed day send one notice.
- **Closing.** `invoice.paid` for the case's invoice clears it with a conditional write; the write
  that clears it sends one email. `past_due` and `unpaid` updates no longer cancel the row.
- **Mail.** The four emails are transactional and go through notification's sender as the usage
  limit email does, to members holding `subscription:manage`. Nurturing and Customer.io are not used:
  the mail must go regardless of marketing consent and carry the exact stop date.
- **Pay.** The button opens the open invoice's Stripe hosted page, falling back to the billing page.

## Consequences

Stripe's own retry schedule and its final action stay dashboard settings: they must keep the invoice
open past day 21 (end with "mark the subscription unpaid" or "leave past due", not "cancel"), or a
customer is cancelled before our pause. Stripe's own failed payment emails duplicate ours unless
turned off. Enterprise, invoice-collected and connected customers never pause.
