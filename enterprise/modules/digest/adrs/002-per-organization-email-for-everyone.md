# ADR-002: The digest is on for everyone, one email per organization, opt-out in settings

**Status:** Accepted (2026-11-26)

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
- Every span, evaluation and coding-agent fact mints a digest job, since the enqueue filter that
  kept jobs to the cohort has no cohort to filter on.
- `DigestSend` rows written under ADR-001 have ids `userId:isoWeek` and no longer match the new
  ids; the module shipped disarmed, so none are expected. Existing `DigestCohortOrganization`
  rows are ignored, and the table is left in place to drop in a later migration.
- A person's opt-out recorded from settings names `settings` as its source send.
