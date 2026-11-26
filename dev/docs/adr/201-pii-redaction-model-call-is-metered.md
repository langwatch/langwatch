# ADR-201: A PII redaction model call is priced per character and metered like Instant Evals

**Date:** 2026-11-11

**Status:** Accepted

**Revised 2026-11-23:** accepted with the owner's decisions on the Cloud price: the rate is
confirmed, there is no free monthly amount, no minimum per call (assumed, the owner may still set
one), and the free list stays with no end date (decisions 12 to 14).

**Revised 2026-11-25:** a span of 8,001 to 32,000 characters is split across model calls by the
caller (ADR-207) and stays one priced batch: decisions 2, 6 and 12 say how.

> One line: every strict batch the PII redaction model answers is priced in data-privacy at a
> published rate per character and recorded as a priced fact; gateway writes it to
> `gateway_spend` as request type `pii_redaction`; billing reports the month's dollars on a
> meter of its own, `langwatch_pii_redaction_usd`, once Stripe holds it.

## Context

- The PII redaction model answers strict analysis for organizations on the
  `release_pii_redaction_model_enabled` flag; everyone else, and every failure, stays on
  Presidio (spec `modules/data-privacy/specs/span-pii-redaction.feature`). Each call leaves one
  usage log line. Nothing is billed.
- Two existing ways to charge usage: billable events send a count and Stripe holds the price
  per plan and currency; Instant Evals price each call in code and send a USD total
  (ADR-174). The product chose the Instant Evals way for PII (2026-11-11), with the price
  proposed for the model: 0.00005 dollars per 100 characters. The owner confirmed it on
  2026-11-23: 0.50 dollars per 1M characters.
- Cloud has a payment gate that is not switched on yet; a chosen set of organizations uses the
  model for free (2026-11-06). Self-hosted installs are gated by licence, not by this meter.
- data-privacy cannot depend on `GatewayApi`: gateway depends on trace, and trace on
  data-privacy, so the edge would close a peer cycle.

## Decision

1. **The price is a rate per character, in code.** 500 nano-USD per character sent to the
   model (0.00005 dollars per 100, 0.50 per million), stamped on every record as the rate
   version `pii_redaction@500nano_per_char`. Characters, not tokens: they are what the batch
   cap, the usage line and the price proposal already count. A change of price is a code change
   and a new rate version.
2. **Only an answered batch is priced.** A batch that falls back to Presidio (too long, breaker
   open, timeout, throttle, refusal, routing error) records nothing: the customer pays for the
   model, not for the fallback. A split span (ADR-207) is answered only when every one of its
   calls is; a span with any failed call falls back and is priced for nobody.
3. **data-privacy records a priced fact; gateway writes the ledger row** (ADR-174 decision 13).
   data-privacy appends `lw.data_privacy.pii_redaction_spend_priced` on the organization's
   aggregate. Gateway's peer subscriber writes one confirmed `gateway_spend` row, request type
   `pii_redaction`, model `pii-redaction-model`, no virtual key, input tokens zero, cost the
   customer price, our estimated cost and the characters in the metadata. Gateway looks up the
   team itself, as for the judge.
4. **The request id is derived from the record and the batch.** A hash of the project, the
   record's own key and the texts sent. A span's key is its trace and span ids; a log record's
   is the time it is stored under (event time, else observed time, else the time it was
   accepted); a metric point's is its metric name, start time and time. A retried ingestion
   gives the same id and the ledger, keyed by project and request id, keeps one row. The same
   text in another record is another call and is charged again: an SDK re-exports a metric's
   attribute set every interval, and a service logs the same line many times. A log record with
   no time carries the time it was accepted, so a retry of it is charged again, as it is also
   stored again.
   The hash is an HMAC under a key derived from the deployment's key pepper (API_KEY_PEPPER,
   else CREDENTIALS_SECRET, else NEXTAUTH_SECRET, as api-key's chain), never a plain hash: the
   id is stored in `gateway_spend` and served back, and a plain hash of a short text such as a
   phone number could be confirmed by hashing guesses. A deployment that names the model and has
   no pepper refuses to boot; one that names no model prices no call and needs none.
5. **Recording never blocks redaction.** A fact that cannot be dispatched is logged at error
   with its amounts and the redacted batch is returned. Under-billing a call is preferred to
   failing a customer's ingestion.
6. **Our cost is an estimate from the call's duration.** Lambda's arm64 rate for 7 GB times the
   measured duration, plus the per-request fee. It ignores the warmer and HTTP deployments
   cost nothing here. It is for margin reports only and is never billed. A split span's cost is
   the sum over its calls: each call's duration at 7 GB plus one request fee per call, so the
   overlap and the extra request fees show in our cost, never in the price.
7. **A free list records at price zero.** Organizations on `release_pii_redaction_model_free` get a
   priced fact with a price of zero and the cost kept. The release flag still says who may use
   the model; the free list says who pays nothing. A free list that cannot be read records
   nothing and logs the full price at error: a recorded fact fixes its request id's price for
   good, so a guessed zero would stay, and a guessed full price could charge a free org.
8. **The spend is outside gateway budgets.** The debits process skips `pii_redaction`
   outcomes, so a spent AI budget never turns redaction off.
9. **A meter of its own, reported only once Stripe holds it.** `langwatch_pii_redaction_usd`,
   in the Instant Evals units (1/10,000 dollar, truncated), its own checkpoint, the same
   usage-billed rule (ADR-174 decision 12). Until the catalog maps the meter in a mode, nothing
   is reported and the checkpoint stays; the first report after carries the month from zero.
   Creating the meter and its price in Stripe is what starts charging.
10. **Reported only to a subscription that prices it.** Stripe accepts a meter event that no
    subscription line prices and bills it at nothing, so a report would advance the checkpoint
    and lose the charge. The PII meter first lists the customer's subscriptions at Stripe and
    reports only when an active, past-due or trialing one has a line on
    `GROWTH_PII_REDACTION_USD`, by price id, lookup key or `langwatch_key` metadata. The check
    is shared with Instant Evals and behaves as ADR-174 decision 18 says: a held month sends
    nothing, writes no total and warns with the amount held; a failed read counts toward the
    circuit breaker; a pending total is replayed. The other meters do not wait on it.
11. **Checkout adds the price.** A Growth checkout in dollars carries the metered
    `GROWTH_PII_REDACTION_USD` line, like Instant Evals, wherever the mode maps it. Euros carry
    none: the meter counts dollars. The price is $1.00 per meter unit (one dollar redacted),
    monthly, mapped in test mode only until live is provisioned.
12. **No free monthly amount.** Every character the model is sent is priced from the first one
    of the month; the meter reports the month's whole total, nothing taken off. The characters
    are counted as sent, after the in-process standard detection has masked what it finds (a
    phone number is counted as its marker), so the customer pays for the text the model read. The
    length caps (8,000 characters for one call, 32,000 for a split span, ADR-207) are measured on
    that masked text too, and a split span is priced on its texts' characters once, as if sent in
    one call: the 200-character overlap between pieces is never billed.
13. **No minimum per call.** A batch is priced at its characters times the rate and never raised
    to a floor: a 50-character span is 25,000 nano-USD. This is assumed, not yet decided for good;
    a minimum would be a code change in data-privacy and a new rate version.
14. **The free list has no end date.** Organizations on `release_pii_redaction_model_free` stay
    free for as long as LangWatch keeps them on it. Ending it is an operator change to the flag,
    not a deploy; calls recorded while it was on stay at zero (decision 7).

## Rationale / Trade-offs

Pricing in code (Instant Evals) over a count priced in Stripe (billable events) was the
product's call: it reuses the ledger, the spend page and the monthly report as they are. The
cost is a USD-only price and a deploy for every price change. A meter of its own keeps the
invoice line honest and lets charging start independently of Instant Evals.

No free monthly amount (decision 12) keeps the price one number a customer can check against
the ledger, and keeps a free tier from being farmed by many small organizations. The cost: no
customer can try the model at no charge without being put on the free list by hand, and the
meter's units (1/10,000 dollar, truncated) leave up to a hundredth of a cent of each month unbilled.

No minimum per call (decision 13) makes a short span cheap, which suits chat traces of many
small turns. The cost: every call carries a fixed part of our cost, the request fee and the
model's time per call whatever its length, so a call of a few characters is priced under what it
costs us. At 7 GB each 100 ms of a call costs about 9,300 nano-USD, the price of 19 characters.
The usage line and the cost kept on every row (decision 6) show how often that happens.

A free list with no end date (decision 14) keeps the promise made to the organizations that
used the model before it was priced. The cost is our model spend with no revenue for as long as
they stay; every free row keeps our cost in its metadata, so a margin report sees it.

Spans over 32,000 characters go to Presidio and are priced for nobody (decision 2). Spans of
8,001 to 32,000 characters, which fell back for free before ADR-207, are now answered and priced
at the same rate per character: the customer on Strict pays for the model on them.

The model's routing reads the flag and the level, never the subscription. A Strict project of an
organization with the flag is priced whatever its plan, and the meter holds the usage until the
subscription carries the price (decision 10). What stops a customer who does not want to pay is
the settings page, which asks before it turns Strict on at a price and keeps the level it had when
it is cancelled; Essential never reaches the model or Presidio. The cost: an organization, team or
project already on Strict (then Presidio) when the flag goes on is priced from its next span with
no question asked. Before turning the flag on for an organization, the operator checks its
levels, or puts it on the free list first.

## Consequences

- Rows land on `gateway_spend` from the first deploy; the monthly report sends nothing until
  the meter is in the catalog.
- A subscription bought before the price existed holds its PII spend until the line is added
  to it. Usage stays on the ledger, so nothing is lost while it waits.
- The report makes one Stripe subscriptions read per organization with PII spend each time
  it runs.
- A spend page lists `pii_redaction` rows beside gateway and Instant Evals spend.
- Settled 2026-11-23: no free monthly amount, no minimum per call (assumed) and a free list
  with no end date. Still open: whether a minimum per call is wanted after all.

## References

- Related ADRs: [ADR-174](./174-instant-evals-judge-call-is-metered.md),
  [ADR-190](./190-instant-evals-routed-judgement-is-priced-from-summed-call-cost.md).
- Spec: `modules/data-privacy/specs/pii-redaction-billing.feature`.
