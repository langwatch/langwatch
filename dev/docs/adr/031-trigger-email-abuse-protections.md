# ADR-031: Trigger email abuse protections — test-fire lockdown, hourly cap, unsubscribe

**Date:** 2026-06-11

**Status:** Accepted

## Context

Trigger notifications (ADR-026/028/030) send customer-authored email to
recipient lists the customer types in freely. Three abuse/cost surfaces are
currently unprotected:

1. **Test fire is an open relay.** `testFireTemplate` lets any user with
   `triggers:update` permission send a rendered email to an arbitrary
   `recipients: string[]` — format-validated only, no membership check, no
   rate limit. A malicious or compromised account can use LangWatch's mail
   infrastructure to spam arbitrary addresses, burning sender reputation.
2. **Immediate-cadence triggers have unbounded volume.** Digest cadences
   coalesce to at most one email per trigger per window (5-minute digest →
   ≤288/day), but `immediate` cadence sends one email per settled matching
   trace. A customer ingesting millions of matching traces produces millions
   of emails — a real provider cost and a deliverability incident, with no
   circuit breaker anywhere in the dispatch path.
3. **External recipients cannot opt out.** Recipients are intentionally
   allowed to be non-team addresses (the UI shows an "External" badge), but
   there is no unsubscribe mechanism, no suppression list, and no
   `List-Unsubscribe` header. A recipient who never consented has no way to
   stop the mail short of contacting LangWatch support; mail providers
   increasingly penalize bulk senders that omit one-click unsubscribe.

See [specs/automations/spam-prevention.feature](../../../specs/automations/spam-prevention.feature)
for the behavioural contract this decision supports.

## Decision

Three protections, sharing one threat model (LangWatch-operated email as an
abuse/cost vector). Slack is exempt throughout: a Slack webhook posts to the
customer's own workspace via a secret URL they provisioned — there is no
third-party victim and no per-message cost to LangWatch.

### 1. Test fire sends only to the requester

`testFireTemplate` stops accepting an email recipient list. The server
resolves the recipient as the authenticated session user's email — the
client-supplied list is removed from the input schema entirely, so there is
nothing to validate or trust. Slack test fire (webhook URL) is unchanged.

A light per-user rate limit (`testfire:{userId}`, sliding window via the
existing `src/server/rateLimit.ts`) guards the mail provider against a stuck
client loop. The limit is generous (default 10/minute) because the recipient
is the requester — this is hygiene, not anti-abuse.

### 2. Per-trigger hourly hard cap on dispatched emails

In the outbox dispatcher's cadence stage (`handleCadenceBatch`), the email
branch consults a Redis fixed-hour counter before sending:

```text
key:    trigger-email-cap:{projectId}:{triggerId}:{floor(now / 1h)}
INCR + EXPIRE 2h; if count > cap → drop
```

Over the cap the dispatcher **does not send**: it logs `logger.error` with
project, trigger, and the running count, marks the outbox job done (a
non-retryable outcome — retrying would re-send the spam), and the send claim
is recorded so replays stay no-ops. The counter increments per email
*dispatch* (one digest of 100 traces = 1), not per trace and not per
recipient.

The cap default is **100 emails per trigger per hour**, env-configurable
(`TRIGGER_EMAIL_HOURLY_CAP`). Digest cadences cannot exceed 12/hour, so the
cap only ever bites `immediate`-cadence triggers — by design.

### 3. Unsubscribe link + suppression list

A new Prisma model:

```prisma
model EmailSuppression {
  id        String   @id @default(nanoid())
  projectId String
  email     String   // normalized to lowercase
  triggerId String?  // null = suppressed for every trigger in the project
  reason    String   // "unsubscribe" (room for "bounce" later)
  createdAt DateTime @default(now())

  @@unique([projectId, email, triggerId])
}
```

Every trigger email — legacy-rendered and Liquid-template-rendered alike —
gets a footer appended **outside** the customer's template (authors cannot
strip it) containing a signed unsubscribe link, plus `List-Unsubscribe` and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers.

The link token is an HMAC (same keyed-hash approach as
`src/server/mailer/triggerNoReply.ts`) over `{projectId, triggerId, email}`,
so the page works without login and cannot be forged to unsubscribe someone
else. The public route (`/unsubscribe?token=…`) offers two scopes: "this
notification only" (row with `triggerId`) and "all notifications from this
project" (row with `triggerId: null`); a POST writes the suppression row.

At dispatch time the email branch filters the recipient list against the
suppression table (trigger-scoped OR project-wide rows). If every recipient
is suppressed, the send is skipped entirely (claim recorded, info log).

**Per-recipient envelopes.** Today recipients ride one envelope as BCC. A
one-click unsubscribe link must identify the recipient, so trigger emails
switch to one send per recipient. The fan-out is bounded by the §2 hourly cap
(cap counts dispatches, recipient fan-out multiplies provider calls but not
cap slots — recipient list size is already bounded at authoring time).

## Rationale

### Why own-email-only for test fire, not a rate-limited recipient list

A rate limit on an arbitrary-recipient send still leaves a spam vector — just
a slower one — and pushes complexity into choosing limits that are generous
enough for legitimate teams yet tight enough to deter abuse. There is no
legitimate need to test-fire at someone else's inbox: the requester is
verifying rendering, and their own inbox shows exactly what recipients will
get. Removing the input eliminates the vector instead of throttling it.

### Why hard cap + drop, not auto-degrade to digest or auto-disable

- **Auto-degrade to digest** preserves every match but silently changes the
  trigger's configured semantics at the worst possible moment (an incident
  storm), and requires the dispatcher to re-route in-flight immediate sends
  through digest coalescing — a second scheduling path to test and reason
  about.
- **Auto-disable** is the strongest cost protection but turns a noisy hour
  into a silent forever: the operator must notice and re-enable, and the
  trigger misses real alerts after the storm passes.
- **Drop + error log** is the simplest mechanism with self-healing semantics:
  the cap resets on the hour, the error log feeds the operator-facing
  automation health surface (ADR-029), and the trigger's configuration is
  never mutated behind the operator's back.

The matches a dropped email would have announced still exist as traces in the
product; the email was the redundant artifact.

### Why a fixed-hour window, not a sliding window

The existing `rateLimit.ts` fixed-window approximation is one Redis
round-trip. The failure mode of a fixed window (up to 2× burst across a
boundary) is irrelevant at this granularity — 120 emails across a boundary
hour vs. 60 is noise compared to the millions the cap exists to stop.

### Why unsubscribe + suppression, not verification-before-send

A verification gate (external addresses must click a confirm link before any
trigger email reaches them) is the stronger anti-abuse posture, but it adds a
verification table, a pending-state UI in the authoring drawer, and setup
friction for the dominant legitimate case (an operator adding their own
team's distribution list). One-click unsubscribe matches what bulk-mail
providers actually require for deliverability, costs recipients one click
only when they *don't* want the mail, and the suppression table doubles as
the home for future bounce handling. Verification remains available as a
follow-up if abuse reports show unsubscribe is insufficient — the suppression
model is forward-compatible with it (`reason` column).

### Why the footer is appended outside the Liquid template

ADR-028 gives customers full control of the email body. If the unsubscribe
footer lived inside the template, a customer could remove it — turning the
compliance feature back off. Appending it in the renderer wrapper after
template rendering makes it structurally unstrippable, like the no-reply
envelope handling in `triggerEmail.tsx`.

### Why per-recipient sends instead of a generic unsubscribe page

Keeping single-BCC envelopes would force an anonymous unsubscribe page where
the visitor types their address — which means unauthenticated writes keyed on
self-asserted emails (anyone can suppress anyone) or an email-confirmation
loop (which is the verification gate we deferred). A per-recipient HMAC link
is both one-click and forge-proof. The provider-call multiplication is the
price, bounded by the hourly cap.

## Consequences

- **Test-fire UX changes.** The recipients input disappears from the
  authoring drawer's test affordance, replaced by "a test will be sent to
  *you@…*". Operators who used test fire to demo a notification to a
  colleague now forward the email instead.
- **One new Prisma model + migration** (`EmailSuppression`). All queries
  include `projectId` per the multitenancy contract.
- **One new public unauthenticated route** (`/unsubscribe`). Token-gated by
  HMAC; no project data exposed beyond the trigger name shown on the confirm
  page.
- **Trigger emails become per-recipient sends.** Provider call volume
  multiplies by recipient-list size. Each recipient gets their own envelope
  (recipient in BCC, hashed no-reply in From/To) so recipients never see each
  other.
- **Dropped sends are visible, not silent.** `logger.error` + a counter the
  ADR-029 health surface can read. Operators of high-volume immediate
  triggers should switch to a digest cadence — the error message says so.
- **The cap is per-trigger, not per-project.** A project with many triggers
  can still aggregate a large hourly volume; a per-project ceiling is a
  follow-up knob if provider costs warrant it.
- **Suppression management ships in v1.** A project-settings view lists
  suppression rows (email, scope, when) to operators with `triggers:view`
  and lets an operator with `triggers:manage` permission remove one — e.g. a
  recipient who unsubscribed by accident and asked to be re-added. Removal is
  a deliberate operator action; nothing re-suppresses automatically.
- **Non-goals:** no Slack capping, no verification-email gate, no bounce
  ingestion (schema-ready via `reason`), no per-project volume ceiling.

## References

- [ADR-026](./026-per-trigger-dispatch-timing.md) — cadence/digest mechanics the cap composes with
- [ADR-028](./028-liquid-templates-for-trigger-notifications.md) — template rendering the footer wraps
- [ADR-029](./029-automation-operator-surfaces.md) — health surface that displays cap drops
- [ADR-030](./030-transactional-outbox-for-stake-sensitive-dispatch.md) — dispatcher stage carrying the cap check
- `src/server/rateLimit.ts` — sliding-window limiter reused for test fire
- `src/server/mailer/triggerNoReply.ts` — existing HMAC keyed-hash pattern the unsubscribe token follows
