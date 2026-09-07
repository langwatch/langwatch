# ADR-126: A directory push is visible while it is happening

**Date:** 2026-08-26

**Status:** Accepted — Wave 3, extends ADR-122's organization view

**Program:** Identity platform redesign — epic `../identity-platform-redesign.md`,
plan `../identity-platform/delivery-plan.md`.

**Builds on:** ADR-122 (reconciliation is a visible surface, and the
organization view renders "projections *and the event log*" — this is the
event-log half, plus the one thing the event log cannot answer),
ADR-101 (what an identity fact may carry), ADR-110 (facts state themselves).

## Context

ADR-122 made directory sync readable and shipped the summary: per connection,
the folded state, the last push, the people managed, and the applies that
failed. What it did not ship is the sequence. An administrator watching a
provider they have just configured is not asking "what is the state" — they
are asking "did the thing I just did arrive, and what did you make of it",
and the summary answers that with a timestamp that either moved or did not.

Two different gaps sit behind that question, and only one of them is a
missing screen.

**The facts exist and are not rendered.** Every push already appends
`scim_user_pushed`, `scim_group_mapped`, `scim_apply_failed`,
`scim_apply_retired` and their recoveries to the `scim_sync` aggregate, whose
tenant is the organization and whose id is the connection. The organization
view folds them into a head and shows the head. The sequence is sitting in the
log, attributable and already payload-safe by ADR-101's rules, read by nobody.

**The requests do not exist as anything.** A SCIM request that never reaches a
handler is answered and forgotten. A token that does not verify is a `401`; a
token that verifies against a lapsed plan is a `403`; a body we cannot parse
is a `400`. None of them append a fact — correctly, because none of them is a
fact about the directory; nothing was decided, so there is nothing to state.
The result is that "my provider says it is pushing and your page says no push
yet" has no answer anywhere in the product, and the person holding it is the
person who just pasted the token.

And there is a hard limit on how much of that second gap can ever be closed.
A SCIM token is an opaque value looked up by SHA-256 hash; it carries no
prefix, no key id, nothing to resolve before the secret matches. **A request
carrying a token we do not recognize cannot be attributed to an organization
at all** — not "is expensive to attribute", cannot. Whatever we build, the
single most common setup failure, a mistyped or stale token, can never appear
on the page of the organization it was meant for.

## Decision

**The organization view grows a per-connection activity feed, read from the
`scim_sync` log.** Newest first: what the directory did, to whom, and whether
it landed. It is a read of events the pipeline already appends — no new fact,
no new event type, no projection. It is the half of ADR-122 that was specified
and not built, and it is bounded by a limit rather than paged, because the
question it answers is about the last few minutes.

**Every request we can attribute is recorded, in a table, not in the log.** A
`ScimRequestLog` row per request that got past authentication: when, which
connection, the method and the resource, the status we answered, and — when we
refused — a stable reason slug and our own short sentence. It is deliberately
*not* an event:

- A request authors nothing. Event truth is what the system decided; an HTTP
  round trip that was refused decided nothing, and ADR-110's "facts state
  themselves" is about consequences, not traffic.
- It is not replayable truth. Rebuilding the world from the log must not
  depend on how many times a provider retried a `GET`.
- It has a retention window. An event log does not; operational evidence
  does. Rows older than the window are deleted, and nothing downstream is
  allowed to derive from them.

**A request we cannot attribute is not recorded.** No row is written for a
token that does not verify. Two reasons, and the second is the load-bearing
one: we do not know whose organization to file it under, and a table written
by unauthenticated traffic is a table anybody on the internet can fill. The
`403` case *is* recorded — a lapsed plan is a credential we recognize.

**What answers the unattributable case instead is the token's own row.** A
token that has never verified has `lastUsedAt` null, and the tokens table
already draws that as "Never". That badge is the answer to "did my provider
reach us with this token", so it says so in words rather than leaving the
reader to infer it. This is the whole remedy available for the most common
failure, and pretending otherwise with a feed that stays empty for a different
reason would be worse than saying it plainly.

## Consequences

- The activity feed is free of new storage and rebuildable by construction: it
  renders the log, so replay correctness is surface correctness, exactly as
  ADR-122 has it for the summary.
- The request log is the first identity-area table that is evidence rather
  than truth. It needs its retention enforced somewhere that runs, and a
  reader that treats an absent row as "we do not know" rather than "it did not
  happen" — a row may have aged out.
- Both surfaces are gated by ADR-122's split: seeing takes `sso:view`,
  and neither adds a write.
- The payload rule holds unchanged. A request row carries a method, a resource
  name, a status, a reason slug and our own sentence. Never a token, never a
  provider's raw message, never a header — the same reason
  `scim_apply_failed` carries a code and not a message.
- **Deployment Impact:** one additive Prisma migration (`ScimRequestLog`,
  indexed by organization and by time for the retention sweep). No backfill: a
  table that starts empty reads correctly, because "no requests recorded" and
  "no requests" are the same sentence on a surface that has just been turned
  on. Deleting the table is a no-op for every other surface.
- Spec: `specs/identity/scim-reconciliation-surfaces.feature` (the feed, beside
  ADR-122's scenarios) and `specs/identity/scim-request-log.feature`.
