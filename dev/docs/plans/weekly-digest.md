# Weekly digest emails

Status: design frozen 2026-09-30. Requirements: `enterprise/modules/digest/specs/digest.feature`.

LangWatch Cloud sends each person one short weekly email about what their usage did that week, with an
optional "what's new" card. Mail goes out through our own `NotificationApi.sendEmail`; no third party.
It is sent weekly, anyone can unsubscribe in one click, and we measure clicks and unsubscribes. We start with
a hand-picked cohort, chosen from a gallery in Cloud admin that previews each person's real email first.

## Home

A new enterprise module, `enterprise/modules/digest` (subjects `digest`, `digest-subscription`,
`digest-send`). Enterprise, because it only runs where ops's cloud-ops capability is on: every route
admits through `OpsApi.admitCloudAdmin` and answers `not_found` elsewhere (§3.5). Not `nurturing`: its
ADR-001 forbids tables and peers, and the digest needs both.

## Where the numbers come from

Every number is a running projection digest folds from the owners' events as they happen; nothing is
queried per person at send time. Subscribers live in digest, on each owner's pipeline (§9, nurturing's
shape): each extracts bounded facts and sends digest's `recordActivity` command, keyed by aggregate
`(projectId, isoWeek)` or `(userId, isoWeek)`, with `coalesceMaxBatch` so a burst of spans drains as one
batched append (coding-agent's source subscribers are the precedent, ADR-056).

| Owner event | Facts folded |
| --- | --- |
| trace span received / recorded | traces (root spans), spans, errors, tokens, cost, latency histogram, top models (capped) |
| coding-agent span/log/metric facts contributed | per user: sessions (distinct `sessionId`, capped set in the fold), tokens, cost, active time; from the agents' own OTel metrics via the contract's name normalisation: lines, commits, pull requests (`*.pull_request.count`) |
| evaluation completed | runs, passed, failed, errored, per evaluator (capped) |
| scenario simulation run finished | runs, passed, failed per project |
| suite run item completed | items, passed, failed |
| plan limit | the one read at send: `EntitlementApi.getUsage`, once per enrolled organization |

Projections (fold, Postgres, five ISO weeks kept, older rows swept by the weekly wake):
`DigestProjectWeek`, `DigestUserWeek`. Latency is a fixed bucket histogram so p50/p95 fold without
keeping spans. Folds hold ids and numbers only; names and addresses are read from `UserApi` when
an email is rendered, never stored (nurturing's rule).

## Templates (separate, in `@langwatch/mail`)

| Template id | For | Eligible when |
| --- | --- | --- |
| `digest-plan-pressure` | org admins | month's usage at 80% of the plan limit or more, or maxed; names what fills it (full coding-agent traces) and offers sampling, redaction and upgrade |
| `digest-scenarios-trend` | project members | scenario failure rate this week differs from the 4-week baseline by 10 points or more, either way ("more failing than usual" or "getting better") |
| `digest-coding-agent-week` | each person | 5 or more coding-agent sessions of theirs this week |
| `digest-traces-week` | project members | 1,000 or more traces this week: volume, errors, cost, tokens, p50/p95 latency, top models, eval pass rates (Sentry's weekly report, for LLMs) |
| `digest-whats-new` | anyone else | fallback: this week's update and one nudge |

Each person gets one email a week: the first eligible template in the order above (`rules/`,
pure). Every template carries the week's "what's new" card under the hero when one is published: title,
gradient, body, one link. Thresholds are constants in `rules/`, tuned from the gallery.

## Tables (Postgres, owned by digest)

- `DigestCohortOrganization` — organizations enrolled in the send (default: none, so nothing sends).
- `DigestSubscription` — per user; `unsubscribedAt`, `unsubscribedFromSendId`. No row = subscribed.
- `DigestProjectWeek`, `DigestUserWeek` — the fold projections above; the gallery and the send read them.
- `DigestSend` — one per user per week: template, ISO week, links `{key: url}`, message id, sentAt.
- `DigestClick` — send id, link key, at.
- `DigestUpdate` — the "what's new" card: title, body, link, gradient, week it goes out.
- `DigestSettings` — singleton: `armed` (the weekly send's master switch, default false).

## Pipeline (`digest`)

- Subscribers on trace, coding-agent, evaluation, scenario and suite events → `recordActivity` →
  the two weekly fold projections, all week long.
- Scheduled process manager, hourly wake: after Monday 08:00 UTC, when last week's sends are not yet
  planned and settings are armed, emit one `sendDigest` intent per enrolled member, keyed
  `(userId, isoWeek)`, so a redelivery sends nothing. The intent reads the finished week's folds, picks
  the template and sends. Unsubscribed users and members of organizations no longer enrolled are
  skipped when the intent is handled. The same wake sweeps weeks older than five.

## Transports

- REST, unauthenticated, rate-limited as automation's unsubscribe pair is (ADR-031):
  - `GET /api/digest/unsubscribe?token=` page data; `POST /api/digest/unsubscribe` RFC 8058 one-click.
    The token is an HMAC over `(userId, sendId)` with the session secret; resubscribe from the same page.
  - `GET /api/digest/c/:token` records a click and answers 302. The token names a send id and a link
    key only; the target URL is read from `DigestSend.links`, so there is no open redirect.
- tRPC `digest.*` (Cloud admin only): cohort list (sortable), preview a person's email for any
  template, enrol/unenrol, refresh, edit the update, arm/disarm, send myself a test, metrics.

## Gallery: `/ops/cloud/digests` (digest's browser package, `requires: "ops:manage"`)

- Cohort table from the current and last week's folds, sortable by: coding-agent cost, coding-agent sessions,
  traces this week, % of plan limit, scenario runs, members, template picked. Enrolled toggle per row.
- A person's row opens their email: every eligible template side by side (desktop, mobile, dark),
  the picked one marked, and "send to me" as a test.
- "What's new" editor with a live card preview. An arm switch that shows how many people would receive mail.
- Metrics by template and week: sent, unique clickers, click rate, unsubscribes.

## Out of v1

Open tracking (Apple Mail privacy pre-fetch inflates opens past use), per-template unsubscribe (one
list, one opt-out), per-timezone send time, a link from user settings. Add them when the metrics call for it.
