# ADR-002: The digest is on for everyone, one email per organization, opt-out in settings

**Status:** Accepted (2026-11-26). Amended 2026-11-27 by [ADR-003](./003-one-feed-email.md): what one email says.

**Behavioural contract:** [Weekly digest emails](../specs/digest.feature)

**Amends:** [ADR-001](./001-digest-boundary.md). **Plan:** langwatch/tasks#1306.

## Context

ADR-001 sent the digest to operator-enrolled organizations only, and one email per person from
their busiest organization. The owner decided the digest goes to everyone, one email per person
per organization, and that the email's link opens the person's email preferences.

## Decision

- **No enrolment.** The cohort is every organization. Folding, the weekly plan and the send cover
  all of them. `setEnrolled` and the `DigestCohortOrganization` reads are gone. The operator's
  `armed` switch stays the kill switch: nothing sends until an operator arms it.
- **One send per (person, organization, week).** The home-organization pick is gone. The send
  intent id, the `DigestSend` row id and the mailer idempotency key all carry the organization:
  `userId:organizationId:isoWeek` (the intent and key as `digest:...`). Each email shows only that
  organization's week, and its subject starts with the organization's name. A quiet week still
  sends nothing.
- **One opt-out per person**, covering every organization, stored once in `DigestSubscription`.
  The signed `/api/digest/unsubscribe` page and the RFC 8058 one-click POST work as before and
  stay the target of the `List-Unsubscribe` header and signed-out clicks.
- **A switch in settings.** The Profile page has an Email preferences band with a "Weekly
  digest" switch. It reads and writes the same opt-out through `DigestApi.getPreference` and
  `setPreference` and tRPC `digest.getMyPreference` and `digest.setMyPreference`, for the signed-in
  person only (the input names no user). The email's footer link opens
  `/settings/profile#email-preferences`.
- **Test send** keeps working: an operator sends a chosen member's week for a chosen
  organization to themselves.

## Consequences

- Every member of every organization is asked a send each week; a quiet one is skipped when
  handled. The plan's cost grows with total membership, not with enrolled organizations.
- **Spans are not folded.** A fold per span across all traffic is a Postgres write per span, so
  the week's trace numbers (traces, errors, tokens, cost, median and 95th-percentile duration, and
  traces per model) are read from `AnalyticsApi.getTimeseries` when an email is composed, for the
  projects the recipient may see only: live, non-governance ones, a personal workspace only for its
  owner, then those the recipient holds `project:view` on. A project's week costs two reads (the
  totals, and a model breakdown only if it had traces) plus one traces-only read of the week
  before for the change; the change line is dropped, and the email still sent, when that last
  read fails. The window is half-open, as analytics' `endDate` is
  exclusive: the next week starts where this one ends. A read is remembered per
  organization, project and week in each process for thirty minutes (single flight, the oldest
  entry evicted at the cap) and at most eight reads run at once per process; across workers the
  same project's week may be read once per worker, so a plan's load is bounded by workers times
  projects, not by members. Models count traces, not model calls as the fold did.
  Evaluation, scenario and coding-agent facts are still folded (analytics cannot group evaluations
  by evaluator type, which the email names); each is one digest job, so their volume is the thing
  to watch once armed.
- **The plan is one intent per organization.** The hourly plan only pages organization ids and
  asks one `planOrganization` intent per organization, keyed by organization and week; that
  intent asks one send per member, and a failure retries through the outbox for that organization
  alone. The week is marked planned once every organization has been asked; an organization whose
  intent exhausts its attempts is not planned again that week.
- `DigestSend` rows written under ADR-001 have ids `userId:isoWeek` and no longer match the new
  ids; the module shipped disarmed, so none are expected. Existing `DigestCohortOrganization`
  rows are ignored, and the table is left in place to drop in a later migration.
- A person's opt-out recorded from settings names `settings` as its source send.
