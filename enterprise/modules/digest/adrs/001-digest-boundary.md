# ADR-001: Digest owns the weekly email and sends it through our own mailer

**Status:** Accepted (2026-11-19)

**Behavioural contract:** [Weekly digest emails](../specs/digest.feature)

**Related:** `dev/docs/plans/weekly-digest.md`, `dev/docs/ARCHITECTURE.md` sections 4, 5 and 9,
automation's ADR-031 (the unsubscribe token format).

## Context

LangWatch Cloud sends each person one weekly email about their week's usage, picked from five
templates by what their data shows. Operators choose the cohort and arm the send in Cloud admin;
anyone can unsubscribe in one click.

## Decision

`digest` is an enterprise module that owns the weekly digest end to end: the week's folds, the
template rules (first eligible template wins), the cohort, the switch, the send and the
unsubscribe.

- The email is one of the five `@langwatch/mail` digest templates, rendered in this process and
  sent through our own mailer, `NotificationApi.sendEmail`. No third party sends it.
- Mail leaves digest only through its mail channel, bound to `NotificationApi` (§5 channel
  binding). Digest owns no rendering code, no SMTP or provider client and no mail credential.
- A member's week is sent at most once: the send intent is keyed by person and ISO week, the
  `DigestSend` row is checked before sending, and the mailer is given the idempotency key
  `digest:{userId}:{isoWeek}`.
- Every email carries an unsubscribe link and the RFC 8058 one-click header, both to
  `/api/digest/unsubscribe?token=`. The token is ADR-031's format, an HMAC-SHA256 over the
  person and the send, signed with the session secret; it is the whole authorization.
- An opted-out member is never sent the digest. The opt-out is read when each send is handled,
  not when the week is planned.
- A template with nothing to show sends nothing: no email and no `DigestSend` row.
- Safe by default: the send is disarmed and no organization is enrolled, so installing the
  module sends nothing. Only projects of enrolled organizations fold.

## Public surfaces and transports

`DigestApi`, implemented by `DigestModule`.

- tRPC `digest` (Cloud admin only): enrol or unenrol an organization, arm or disarm the send, and
  send a member's email to the operator as a test. The platform door needs `ops:manage` and hides
  the router from non-staff; the app admits through `OpsApi.admitCloudAdmin`, so it answers
  not_found where cloud ops is off (§3.5). A test goes to the operator's own address, is marked
  in its subject, writes no `DigestSend` row, and its unsubscribe token names the operator.
- REST `digest`, public, token-authorized, literal addresses with no `/api/v1` twin:
  `GET /api/digest/unsubscribe` answers a page that changes nothing (a link scanner's prefetch
  unsubscribes no one); `POST /api/digest/unsubscribe` is the one-click opt-out;
  `POST /api/digest/resubscribe` undoes it from the same page. A token whose signature does not
  match is refused with `digest_link_invalid` (400) and changes nothing.

## Dependencies

Peers, through `*Api` only: `OpsApi` (admission), `OrganizationApi` (members, admins, the
organization's name), `ProjectApi` (an enrolled organization's projects, a personal project's
owner, a project's name and slug), `UserApi` (the address an email goes to) and `EntitlementApi`
(the month's usage, read once per send). The folds listen to trace, evaluation, scenario and
coding-agent events through peer subscribers.

Channel binding: `NotificationApi`, for `sendEmail` only.

## Persistence

Postgres, owned by digest: `DigestCohortOrganization` (enrolled organizations),
`DigestSubscription` (a person's opt-out and the send it came from; no row is subscribed),
`DigestProjectWeek` and `DigestUserWeek` (the folds), `DigestSend` (one row per person and week,
id `userId:isoWeek`, written once the mailer accepted the email) and `DigestSettings` (`armed`,
the last planned week). Rows hold ids and numbers only: names and addresses are read from their
owners when an email is rendered and never stored. Folds older than the sent week's four-week
baseline are swept every hour.

## Runtime and registration

`defineProcessModule("digest")`, installed in api, worker and tasks. Two pipelines:

- `digest` folds the owners' facts into weeks. Each fact is keyed by its source, and a repeat
  within an hour is dropped before it is appended. An enqueue filter keeps jobs to the enrolled
  cohort's projects.
- `digest_send`: a scheduled process manager wakes hourly and hands the outbox one plan of the
  sendable week (last week, once Monday 08:00 UTC has passed). Armed and not yet planned, the
  plan asks one send per enrolled member; each ask becomes one `sendDigest` intent keyed by the
  person and week. The send is skipped when the switch is off, the organization was unenrolled
  or the member opted out since the plan, or when the person has no address.

## Environment and configuration

- Config: `publicBaseUrl` (`BASE_HOST`), the origin every link in the email is built on. A send
  without it is refused by name.
- Secret: `NEXTAUTH_SECRET` (the shared session secret), which signs and verifies unsubscribe
  tokens. Without it no token is signed or accepted.
- Thresholds are constants in the rules.

## Errors

The rules are total. `digest_member_not_found` refuses a test for someone who is not an active
member of the organization named. `digest_nothing_to_send` refuses a test whose pick has nothing
to show. `digest_link_invalid` refuses an unsubscribe token that does not verify.

## Contracts and validation

The props digest builds for a template are parsed by that template's own schema in
`@langwatch/mail` when it is rendered. `digestTokenQuerySchema` bounds the token the REST
routes read.

## Consequences

Digest depends on `@langwatch/mail` for its templates and on notification for delivery; a mailer
failure fails the send intent, which retries with the same idempotency key. Clicks are not
tracked: links in the email go straight to their targets.
