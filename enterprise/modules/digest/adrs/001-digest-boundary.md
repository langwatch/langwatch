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
- A member's week is sent at most once: the send intent is keyed by person and ISO week, and the
  `DigestSend` row is claimed (inserted once, on its id) before the mailer is called. The email is
  rendered and its `SendEmailCommand` parsed before the claim, so a template or envelope refusal
  claims nothing and the retry can still send it; the mail channel only sends. Only the attempt
  that claimed the row sends; a failure after the claim loses that week's email rather than send
  it twice, since SMTP does not dedupe a retry. The mailer is also given the
  idempotency key `digest:{userId}:{isoWeek}`.
- A week is planned only from Monday 08:00 UTC, and the plan covers last week. Before 08:00 on
  Monday the wake plans nothing, so arming in those hours never sends the week before last.
- Every email carries an unsubscribe link and the RFC 8058 one-click header, both to
  `/api/digest/unsubscribe?token=`. The token is ADR-031's format with its `exp` (epoch seconds,
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
  match, or whose `exp` has passed, is refused with `digest_link_invalid` (400) and changes
  nothing; with no signing secret every route answers 503 (`digest_links_unavailable`, which the
  wire masks as `internal_error` like every platform fault that is not a transient refusal). Every
  page carries `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`.

## Dependencies

Peers, through `*Api` only: `OpsApi` (admission), `OrganizationApi` (members, admins, the
organization's name), `ProjectApi` (an enrolled organization's projects, a personal project's
owner, a project's name, slug and team), `AuthzApi` (which projects a member may view),
`UserApi` (the address an email goes to, and whether the person an unsubscribe link names still
exists) and `EntitlementApi` (the month's usage, read once per send). The folds listen to trace,
evaluation, scenario and coding-agent events through peer subscribers. A peer subscriber on
user's `lw.user.erased` clears digest rows on user erasure: the person's `DigestSubscription`,
`DigestSend` and `DigestUserWeek` rows, in every organization, as nurturing does.

Channel binding: `NotificationApi`, for `sendEmail` only.

## Persistence

Postgres, owned by digest: `DigestCohortOrganization` (enrolled organizations),
`DigestSubscription` (a person's opt-out and the send it came from; no row is subscribed),
`DigestProjectWeek` and `DigestUserWeek` (the folds), `DigestSend` (one row per person and week,
id `userId:isoWeek`, claimed just before the email is handed to the mailer) and `DigestSettings` (`armed`,
the last planned week). Rows hold ids and numbers only: names and addresses are read from their
owners when an email is rendered and never stored. Folds older than the sent week's four-week
baseline are swept every hour.

## Runtime and registration

`defineProcessModule("digest")`, installed in api, worker and tasks. Two pipelines:

- `digest` folds the owners' facts into weeks. Each fact is keyed by its source, and a repeat
  within an hour is dropped before it is appended. An enqueue filter keeps jobs to the enrolled
  cohort's projects.
- The owners' facts reach the folds through peer subscribers that record digest's own fact, not
  through peer fold projections. A fold's `apply` is synchronous, but turning an owner's fact
  into digest's needs reads: the project's enrolled organization, and for a coding-agent fact
  the personal project's owner (`ProjectApi`). A peer fold also takes no enqueue filter, so
  every span on the platform would mint a job; the peer subscriber's filter keeps jobs to the
  cohort. The cost is a second append per cohort fact.
- A fact's week is the time its owner gives it: a span's start as the client reported it, an
  evaluation's completion, a run's finish. A fact that arrives after its week's emails went out
  is not in them, and a client's clock skew or a backfill can put a span in another week.
- `digest_send`: a scheduled process manager wakes hourly and, from Monday 08:00 UTC, hands the
  outbox one plan of last week; before 08:00 on Monday it hands none. A plan of any other week
  than the one its slot may send is refused. Armed and not yet planned, the plan asks one send
  per enrolled member; each ask becomes one `sendDigest` intent keyed by the
  person and week. The send is skipped when the switch is off, the organization was unenrolled
  or the member opted out since the plan, or when the person has no address.

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
to show. `digest_operator_address_missing` refuses a test when the operator has no address. The test send respects enrolment and opt-out: `digest_organization_not_enrolled` refuses
a test for an organization not enrolled, and `digest_member_unsubscribed` one for a member who
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

A person in several enrolled organizations is sent one email a week, from the organization where
their week had the most activity (traces of the projects they may view plus their own coding-agent
sessions), the lowest organization id on a tie. The plan decides it once and stores it on each send
request, so the sends agree even if the week's folds change before they run. A send whose stored
home can no longer send (unenrolled, or the person left it), or a request with none stored, ranks
the organizations the person is still in when it runs. A pick that cannot be built falls through to
the next eligible template. A deactivated profile is not mailed. A plan that could not read one
organization leaves the week unplanned, so the next hourly wake retries it; requests already made
are keyed and not repeated.

Resubscribing uses the same purpose-bound, expiring token as unsubscribing; it only restores an
email the person chose to receive. Accepted. The pages are served `no-store` with
`Referrer-Policy: no-referrer`, since the token is in their address.
