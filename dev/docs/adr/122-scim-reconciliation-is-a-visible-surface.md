# ADR-122: SCIM reconciliation is a visible surface

**Date:** 2026-08-25

**Status:** Accepted — Wave 3, implemented with D08's remainder

**Program:** Identity platform redesign — epic `../identity-platform-redesign.md`,
plan `../identity-platform/delivery-plan.md`, deliverable `D08-scim-per-connection.md`
(the machinery every word of this reads).

**Builds on:** ADR-101 (the identity pipeline and what its events may carry),
ADR-110 (facts state themselves; a projection is rebuildable truth),
D05's identity surfaces (the operator surface this extends, and the
see/manage permission split the org view is gated by).

## Context

D08 turned directory sync into event truth: a `ScimSync` aggregate whose
`scim_sync_state` projection folds the connection's lifecycle
(`TOKEN_ISSUED → SYNCING → ERROR → REVOKED`), a `(connectionId, externalId) →
userId` mapping, `scim_apply_failed` events as dead-letter evidence, and every
membership consequence flowing through `grants.*` with `source: "scim"` on the
fact. The pipeline retries idempotently and retires unretryable applies
visibly.

Nobody can see any of it. The SCIM settings page mints and revokes tokens and
answers nothing else; "is the directory syncing", "why is this person still
here", "who did the directory remove last Tuesday" are all support tickets
today, answered — when they are answered — with SQL. That inverts the point of
making sync event-sourced: the whole reason a fact states itself is so a person
can read it.

Two different people need to read it, and they need different depths. An
organization administrator debugging their own directory needs their
connections' state, their failures in plain words, and their people — and must
be structurally unable to see anyone else's. A platform operator holding a
support case needs everything, across every customer: the retired intent
behind a failure, the retry history, the mapping row that explains why a push
matched the wrong nobody.

## Decision

Reconciliation state becomes a read surface in two views, and stays a read
surface: both views render projections and the event log, and neither adds a
write path to sync — with one exception, named below.

**The organization view lives where SCIM is already managed.** The SCIM
settings page (which D08's remainder rewrites around connection-scoped tokens)
grows the reconciliation panel: per connection, the folded sync state and what
it is waiting for, the last push received, how many people the directory
manages (the mapping count), the most recent directory-caused membership
changes — deactivations and removals included, read from the grants facts the
directory authored — and every failed apply as words a customer can act on,
never an error code. It is scoped at the data layer the way the D05 org
surface is: the organization is where the query is built from, not a filter.
Seeing this view takes the D05 "see single sign-on" permission; token and
group-mapping management keep requiring "manage".

**The operator view extends the D05 operator surface.** Same operator menu,
same access refusal, same list/search/drawer grammar — not a new kind of
surface. It reads across every customer: every connection's sync state, error
and dead-letter listings linked to the pipeline's retired intents, retry
history, and the per-person mapping detail (`externalId ↔ userId`, per
connection) that self-serve deliberately does not show.

**The one write: a guarded re-drive.** The operator view may re-dispatch a
retired apply once its cause is fixed. It is a command with the operator on
it, recorded like every act on the operator surface, idempotent like every
apply, and refused when the intent is not retired. The organization view gets
no retry button: the customer's remediation is the directory's next push,
which re-asserts everything the directory still believes — that is D08's
reactivation-is-re-entry rule doing its job, not a missing feature.

## Consequences

- "Setup, manage, and see SCIM" become one page per organization; "total
  oversight" becomes one operator address. Database surgery for sync questions
  ends with D05's lookup ending it for identity questions.
- The views are rebuildable: they show nothing the event log cannot re-derive,
  so replay correctness is also surface correctness.
- The re-drive command is new authority and is treated like the other guarded
  operator acts: named permission, recorded actor, and a spec scenario per
  refusal path.
- Spec: `specs/identity/scim-reconciliation-surfaces.feature` (carried inert
  until D08's remainder binds it). No protocol change, no new SCIM routes.
