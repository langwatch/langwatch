# Weekly digest emails

Status: design frozen 2026-09-30; send, unsubscribe and operator switches built 2026-11-19 (digest
ADR-001). Requirements: `enterprise/modules/digest/specs/digest.feature`.

LangWatch Cloud sends each person one short weekly email about what their usage did that week, with an
optional "what's new" card. Mail goes out through our own `NotificationApi.sendEmail`; no third party.
It is sent weekly, anyone can unsubscribe in one click or from Profile settings, and we measure clicks and
unsubscribes. We start with
everyone, one email per person per organization (digest ADR-002); there is no enrolment, only the `armed`
kill switch and each person's opt-out.

## Home

A new enterprise module, `enterprise/modules/digest` (subjects `digest`, `digest-subscription`,
`digest-send`). Enterprise, because it only runs where ops's cloud-ops capability is on: every
operator route admits through `OpsApi.admitCloudAdmin` and answers `not_found` elsewhere (§3.5). Not
`nurturing`: its ADR-001 forbids tables and peers, and the digest needs both.

## Where the numbers come from

Trace numbers (traces, errors, tokens, cost, p50/p95, top models by traces) are read from analytics
(`AnalyticsApi.getTimeseries`) when an email needs them, never folded: platform span traffic writes no
digest row (ADR-002). The other facts are still folded from the owners' events: subscribers live in
digest, on each owner's pipeline (§9, nurturing's shape), extract bounded facts and send digest's
`recordActivity` command, keyed by aggregate `(projectId, isoWeek)` or `(userId, isoWeek)`.

| Owner event                                    | Facts folded                                                                                                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| coding-agent span/log/metric facts contributed | per user: sessions (distinct `sessionId`, capped set in the fold), tokens, cost, active time; from the agents' own OTel metrics via the contract's name normalisation: lines, commits, pull requests (`*.pull_request.count`) |
| evaluation completed                           | runs, passed, failed, per evaluator (capped)                                                                                                                                                                                  |
| scenario run finished (`scenarioRunFinished`)  | simulation runs: runs, passed, failed (`applyScenario`)                                                                                                                                                                       |
| plan limit (read, not folded)                  | `EntitlementApi.getUsage`, read once per send for the plan-pressure pick                                                                                                                                                      |

Suite items are not folded: no template reads them. Every live project folds.

Projections (Postgres, the sent week and its four-week baseline kept, older rows swept by the hourly wake):
`DigestProjectWeek`, `DigestUserWeek`. Folds hold ids and numbers only; names and addresses are read from `UserApi`,
`OrganizationApi` and `ProjectApi` when an email is rendered, never stored (nurturing's rule).

## Templates (separate, in `@langwatch/mail`)

| Template id                | For             | Eligible when                                                                                                                                       |
| -------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `digest-plan-pressure`     | org admins      | month's usage at 80% of the plan limit or more, or maxed; names what fills it (full coding-agent traces) and offers sampling, redaction and upgrade |
| `digest-scenarios-trend`   | project members | scenario failure rate this week differs from the 4-week baseline by 10 points or more, either way ("more failing than usual" or "getting better")   |
| `digest-coding-agent-week` | each person     | 5 or more coding-agent sessions of theirs this week                                                                                                 |
| `digest-traces-week`       | project members | 1,000 or more traces this week: volume, errors, cost, tokens, p50/p95 latency, top models, eval pass rates (Sentry's weekly report, for LLMs)       |
| `digest-whats-new`         | anyone else     | fallback: this week's update and one nudge                                                                                                          |

Each person gets one email a week: the first eligible template in the order above (`rules/`,
pure). Digest builds the picked template's props (`rules/digest-email.rules.ts`), the mail channel
renders it with `@langwatch/mail` and sends it through `NotificationApi.sendEmail`. Every template
carries the week's "what's new" card under the hero when one is published: title, gradient, body, one
link. Thresholds are constants in `rules/`, tuned from the gallery.

Until the "what's new" editor exists no card is published, so a person whose pick is
`digest-whats-new` is sent nothing that week (no email, no `DigestSend` row).

## Tables (Postgres, owned by digest)

- `DigestSubscription`: per user; `unsubscribedAt`, `unsubscribedFromSendId`. No row = subscribed.
- `DigestProjectWeek`, `DigestUserWeek`: the fold projections above; the send reads them.
- `DigestSend`: one per person per organization per week (id `userId:organizationId:isoWeek`), holding template, ISO week, sentAt.
- `DigestSettings`: a singleton holding `armed` (the weekly send's master switch, default false) and the
  last planned week.
- Not built: `DigestClick` (send id, link key, at), `DigestUpdate` (the "what's new" card), and
  `links` on `DigestSend`.

## Pipeline (`digest`)

- Subscribers on coding-agent, evaluation and scenario events → `recordActivity` →
  the two weekly fold projections, all week long.
- Scheduled process manager (`digest_send`), hourly wake: from Monday 08:00 UTC hands the outbox
  one plan of last week, and before then none. When settings are armed and that week is not
  yet planned, the plan asks one plan per organization, which asks one send per member, and each ask
  becomes one `sendDigest` intent keyed `(userId, organizationId, isoWeek)`, so a redelivery sends nothing. The intent reads the finished
  week (trace numbers from analytics, the rest from the folds), picks the template, renders it, claims the `DigestSend` row and, only if it took
  the claim, sends it with the idempotency key `digest:{userId}:{organizationId}:{isoWeek}`. Disarmed sends, unsubscribed users
  and people with no address are skipped when the intent
  is handled. The same wake sweeps folds older than the sent week's four-week baseline.

## Transports

- REST, unauthenticated, token-authorized (ADR-031's token format):
  - `GET /api/digest/unsubscribe?token=` answers a page that changes nothing.
  - `POST /api/digest/unsubscribe?token=` is the RFC 8058 one-click opt-out (the email's
    `List-Unsubscribe` header and the page's button); `POST /api/digest/resubscribe?token=` undoes it
    from the same page. The token is an HMAC over `(userId, sendId)` with the session secret.
  - Not built: `GET /api/digest/c/:token` (record a click and redirect; the token names a send id and
    a link key only, the target URL read from `DigestSend.links`, so there is no open redirect), and a
    per-caller rate limit on that click route. The unsubscribe routes are limited per caller, as
    automation's pair is, and past the limit answer 429 `digest_unsubscribe_rate_limited`.
- tRPC `digest.*` (Cloud admin only, `ops:manage`): arm/disarm, send
  myself a test of a member's email (to the operator's own address, `[Test]` in the subject, no
  `DigestSend` row). Not built: preview, refresh, the update editor, metrics.

## Gallery: `/ops/cloud/digests` (digest's browser package, `requires: "ops:manage"`; not built)

- Organization table from the current and last week's numbers, sortable by: coding-agent cost, coding-agent sessions,
  traces this week, % of plan limit, scenario runs, members, template picked.
- A person's row opens their email: every eligible template side by side (desktop, mobile, dark),
  the picked one marked, and "send to me" as a test.
- "What's new" editor with a live card preview. An arm switch that shows how many people would receive mail.
- Metrics by template and week: sent, unique clickers, click rate, unsubscribes.

## Out of v1

Open tracking (Apple Mail privacy pre-fetch inflates opens past use), per-template unsubscribe (one
list, one opt-out), per-timezone send time. Add them when the metrics call for it.
