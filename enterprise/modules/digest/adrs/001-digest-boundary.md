# ADR-001: Digest owns the weekly email and sends it through our own mailer

**Status:** Accepted (2026-11-19). Amended 2026-11-26 by [ADR-002](./002-per-organization-email-for-everyone.md): no enrolment, one email per organization, a settings switch.

**Behavioural contract:** [Weekly digest emails](../specs/digest.feature)

**Related:** `dev/docs/plans/weekly-digest.md`, `dev/docs/ARCHITECTURE.md` sections 4, 5 and 9,
automation's ADR-031 (the unsubscribe token format).

## Context

LangWatch Cloud sends each person a weekly email about their week's usage in each organization,
picked from five templates by what their data shows. Operators arm the send in Cloud admin;
anyone can unsubscribe in one click or turn it off in their settings.

## Decision

`digest` is an enterprise module that owns the weekly digest end to end: the week's folds, the
template rules (first eligible template wins), the switch, the send and the opt-out.

- The email is one of the five `@langwatch/mail` digest templates, rendered in this process and
  sent through our own mailer, `NotificationApi.sendEmail`. No third party sends it.
- Mail leaves digest only through its mail channel, bound to `NotificationApi` (§5 channel
  binding). Digest owns no rendering code, no SMTP or provider client and no mail credential.
- A member's week in an organization is sent at most once: the send intent is keyed by person,
  organization and ISO week, and the `DigestSend` row is claimed (inserted once, on its id,
  `userId:organizationId:isoWeek`) before the mailer is called. The email is
  rendered and its `SendEmailCommand` parsed before the claim, so a template or envelope refusal
  claims nothing and the retry can still send it; the mail channel only sends. Only the attempt
  that claimed the row sends; a failure after the claim loses that week's email rather than send
  it twice, since SMTP does not dedupe a retry. The mailer is also given the
  idempotency key `digest:{userId}:{organizationId}:{isoWeek}`.
- A week is planned only from Monday 08:00 UTC, and the plan covers last week. Before 08:00 on
  Monday the wake plans nothing, so arming in those hours never sends the week before last.
- Every email carries the RFC 8058 one-click header to `/api/digest/unsubscribe?token=`, and a
  footer link to the person's email preferences (`/settings/profile#email-preferences`). The token is ADR-031's format with its `exp` (epoch seconds,
  180 days after minting): `base64url(JSON).hex(HMAC-SHA256)`, the HMAC taken over `digest.v1:`
  followed by the JSON, so a token signed with the same secret for another purpose never
  verifies here. It names the person and the send, is signed with the session secret, and is the
  whole authorization.
- An opted-out member is never sent the digest. The opt-out is read when each send is handled,
  not when the week is planned. So are membership and role: a member who left or was disabled
  since the plan is skipped, and the pick reads the role they hold now.
- A member's email shows only the projects they hold `project:view` on (`AuthzApi`): the busiest
  project is picked from those, and no other project's name or numbers reach them.
- A template with nothing to show sends nothing: no email and no `DigestSend` row.
- Safe by default: the send is disarmed, so installing the module sends nothing until an operator
  arms it. Every organization is in once armed; there is no enrolment (ADR-002).

## Public surfaces and transports

`DigestApi`, implemented by `DigestModule`.

- tRPC `digest`, Cloud admin only: arm or disarm the send, and send a member's email for an
  organization to the operator as a test. The signed-in person's own `getMyPreference` and
  `setMyPreference` need no staff grant: they read and write the person's opt-out only. The platform door needs `ops:manage` and hides
  the router from non-staff; the app admits through `OpsApi.admitCloudAdmin`, so it answers
  not_found where cloud ops is off (§3.5). A test goes to the operator's own address, is marked
  in its subject, writes no `DigestSend` row, and its unsubscribe token names the operator.
- REST `digest`, public, token-authorized, literal addresses with no `/api/v1` twin:
  `GET /api/digest/unsubscribe` answers a page that changes nothing (a link scanner's prefetch
  unsubscribes no one); `POST /api/digest/unsubscribe` is the one-click opt-out;
  `POST /api/digest/resubscribe` undoes it from the same page. A token whose signature does not
  match, or whose `exp` has passed, is refused with `digest_link_invalid` (400) and changes
  nothing; with no signing secret every route answers 503 (`digest_links_unavailable`, which the
  wire masks as `internal_error` like every platform fault that is not a transient refusal). Every
  page carries `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`.

## Dependencies

Peers, through `*Api` only: `OpsApi` (admission), `OrganizationApi` (every organization, its members, admins and name), `ProjectApi` (a project's organization, a personal project's
owner, a project's name, slug and team), `AuthzApi` (which projects a member may view),
`AnalyticsApi` (trace numbers per project and week), `UserApi` (the address an email goes to, and whether the person an unsubscribe link names still
exists) and `EntitlementApi` (the month's usage, read once per send). The folds listen to evaluation, scenario and coding-agent events through peer subscribers; a week's trace numbers are read from `AnalyticsApi` (ADR-002). A peer subscriber on
user's `lw.user.erased` clears digest rows on user erasure: the person's `DigestSubscription`,
`DigestSend` and `DigestUserWeek` rows, in every organization, as nurturing does.

Channel binding: `NotificationApi`, for `sendEmail` only.

## Persistence

Postgres, owned by digest: `DigestSubscription` (a person's opt-out and the send it came from; no row is subscribed),
`DigestProjectWeek` and `DigestUserWeek` (the folds), `DigestSend` (one row per person, organization and week,
id `userId:organizationId:isoWeek`, claimed just before the email is handed to the mailer) and `DigestSettings` (`armed`,
the last planned week). Rows hold ids and numbers only: names and addresses are read from their
owners when an email is rendered and never stored. Folds older than the sent week's four-week
baseline are swept every hour.

## Runtime and registration

`defineProcessModule("digest")`, installed in api, worker and tasks. Two pipelines:

- `digest` folds the owners' facts into weeks. Each fact is keyed by its source, and a repeat
  within an hour is dropped before it is appended. There is no enqueue filter: every project's
  activity folds, under its organization.
- The owners' facts reach the folds through peer subscribers that record digest's own fact, not
  through peer fold projections. A fold's `apply` is synchronous, but turning an owner's fact
  into digest's needs reads: the project's organization, and for a coding-agent fact
  the personal project's owner (`ProjectApi`). A peer fold also takes no enqueue filter, so
  every coding-agent span-facts contribution mints a job, which is the cost of being on for everyone:
  a second append per fact, and a memoised project-to-organization lookup. Platform spans mint
  none (ADR-002).
- A fact's week is the time its owner gives it: a span's start as the client reported it, an
  evaluation's completion, a run's finish. A fact that arrives after its week's emails went out
  is not in them, and a client's clock skew or a backfill can put a span in another week.
- `digest_send`: a scheduled process manager wakes hourly and, from Monday 08:00 UTC, hands the
  outbox one plan of last week; before 08:00 on Monday it hands none. A plan of any other week
  than the one its slot may send is refused. Armed and not yet planned, the plan asks one send
  per member of every organization; each ask becomes one `sendDigest` intent keyed by the
  person, organization and week. The send is skipped when the switch is off, the member opted
  out since the plan, left the organization, or has no address.

## Environment and configuration

- Config: `publicBaseUrl` (`BASE_HOST`), the origin every link in the email is built on. A send
  without it is refused by name.
- Secret: `NEXTAUTH_SECRET` (the shared session secret), which signs and verifies unsubscribe
  tokens. Without it no token is signed or accepted: a send fails before anything is mailed or
  claimed, and the REST routes answer `digest_links_unavailable` (503).
- Thresholds are constants in the rules.

## Errors

The rules are total. `digest_member_not_found` refuses a test for someone who is not an active
member of the organization named. `digest_nothing_to_send` refuses a test whose pick has nothing
to show. `digest_operator_address_missing` refuses a test when the operator has no address. The test send respects opt-out: `digest_member_unsubscribed` refuses one for a member who
opted out; arming is not required. `digest_link_invalid` refuses an unsubscribe token that does
not verify, has expired, or names a person who no longer exists, so no subscription row is
written for them. `digest_links_unavailable` (503) refuses every token, and every send, when no signing secret is
configured.

## Contracts and validation

The props digest builds for a template are parsed by that template's own schema in
`@langwatch/mail` when it is rendered. `digestTokenQuerySchema` bounds the token the REST
routes read.

## Consequences

Digest depends on `@langwatch/mail` for its templates and on notification for delivery. A
failure before the claim, rendering included, fails the send intent, which retries; a mailer
failure after the claim is not resent, so that member misses the week. The email goes out as
HTML only: `SendEmailCommand` takes no plain-text part, so the template's rendered text is not
sent. Clicks are not tracked: links in the email go straight to their targets.

A person in several organizations is sent one email a week for each, about that organization's
week alone, with the organization's name leading the subject so they tell apart. There is no
ranking: each organization's send stands on its own. A pick that cannot be built falls through to
the next eligible template. A deactivated profile is not mailed. Each organization is planned
as its own intent (ADR-002), so one that cannot be read fails and retries alone; requests already
made are keyed and not repeated.

Resubscribing uses the same purpose-bound, expiring token as unsubscribing; it only restores an
email the person chose to receive. Accepted. The pages are served `no-store` with
`Referrer-Policy: no-referrer`, since the token is in their address.
