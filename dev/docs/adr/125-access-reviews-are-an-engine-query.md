# ADR-125: Access reviews are an engine query

**Date:** 2026-08-25

**Status:** Proposed (2026-08-25)

**Builds on:** [ADR-092](092-unified-authorization-engine.md) §1 (one registry,
with resource knowledge — the matrix that makes a role name interpretable), §6
(one Access surface, with `explain()` built in), §10 (offboarding with proof —
the shipped precedent for evidence as a product surface), §13 (the grants
ledger: one writer, two views, one insert-only audit subscriber), and the
"What falls out for free" entry *Access reviews / SOC 2 evidence*, which this
ADR implements. Nothing in ADR-092 is superseded.
[ADR-110](110-grant-aggregates-are-grants.md) (grant aggregates; the
`occurredAt` / `acceptedAt` pair and the deterministic ids this relies on).
[ADR-123](123-an-agent-session-is-a-principal.md) (a session is not a grant —
why agent sessions are deliberately absent from the artefact).
[ADR-057](057-token-gated-trace-sharing.md) (share-link possession, which this
must not weaken).
[ADR-045](045-domain-errors-handled-boundary.md) (handled errors, `fault`).

**Numbering:** 125 was assigned by the orchestrator to avoid a concurrent-draft
collision. 117-124 are spoken for: the identity wave holds 117-122, and **123
and 124 are being written on this same branch right now**. This ADR takes the
first number past all of them rather than filling a gap that is already claimed.
`dev/docs/adr/` on this worktree tops out at 123.

**Related specs:** `specs/rbac/access-reviews.feature` (this ADR),
`specs/rbac/expiring-grants.feature` (the `expiresAt` term this must show),
`specs/rbac/agent-principals.feature` (which already specifies that a standing
review lists no assistant sessions), `specs/rbac/authz-grants.feature`,
`specs/rbac/denial-explanations.feature`.

## Context

### What an auditor actually asks for

A SOC 2 Type II engagement does not ask for "an authorization model". Against
the common criteria for logical access (CC6.1-CC6.3) it asks three concrete
questions, and it asks them the same way every year:

1. **User access review.** *"Show me, for a period, the list of everyone with
   access to this system and what that access was, and show me that a
   responsible person looked at it."* The evidence is a list plus a date plus a
   name. The list has to be complete and it has to be interpretable — a column
   saying `custom:role_2f8` proves nothing to a reader who cannot see what that
   role grants.
2. **Termination / offboarding.** *"Pick five leavers. Show me their access was
   removed, and when."* The evidence is per-person and needs a timestamp.
3. **Change history.** *"Show me every access change in the period, and that
   each was authorised."* The evidence is a log that cannot be edited after the
   fact.

We can answer (2) today and half of (1). We cannot answer (3) as one artefact,
and the half of (1) we can answer is not interpretable without a human
translating role names by hand. Every one of those gaps is a query we are not
running, not a fact we do not hold — which is what makes this an ADR about a
surface rather than about storage.

### What already exists

- **The proof shape.** `offboardUserFromOrganization`
  (`packages/authz-server/src/offboard.ts:49-79`) removes every grant source in
  one transaction and then re-collects **inside** that transaction to prove
  `effectivePermissions(dave, acme) == ∅` (`proveNothingResolves`,
  `offboard.ts:96-122`), rolling the whole thing back and raising
  `offboard_incomplete` if anything still resolves. This is the precedent: the
  product does not *assert* that access is gone, it *asks the engine* and fails
  loudly on disagreement. An access review is the same move with the question
  inverted.
- **The pure query.** `AuthzService.effectivePermissions`
  (`packages/authz-server/src/authz.service.ts:138-163`) filters
  `ALL_PERMISSIONS` through `engine.decideWithCeiling` for one principal at one
  scope. It already applies the API-key owner ceiling and resource grants. It is
  the whole of the review's derivation. What it does **not** do today is answer
  for anybody but the caller: the only tRPC surface over it
  (`platform/app/src/server/api/routers/authz.ts:13-44`) hard-codes
  `principal: { type: "user", id: ctx.session.user.id }` and says so in its
  comment — *"it never answers for other principals"*.
- **The state, with its dates.** Since the grants ledger, `Grant` rows carry
  `occurredAt` (business time of the attach, backdated for imported facts),
  `expiresAt` (the stated end — the expiring-grants term), `revokedAt` and
  `revokedReason`. Critically, **a revoke marks the row rather than deleting
  it**: `prisma/schema.prisma:2712-2720` states the reason in the schema —
  *"Deleting made the projection order-dependent … and it threw away the answer
  to when a grant ended and why."* The same holds for `Role.deletedAt`.
- **The change log.** The audit subscriber
  (`.../pipelines/authz-grants/subscribers/authzAuditTrail.subscriber.ts`) turns
  six event types — attach, role_change, revoke, role_defined,
  role_permissions_changed, role_deleted — into `AuditLog` rows prefixed
  `authz.grants.` (`schemas/constants.ts:73`). The sink is insert-only with an
  id derived from the event id and `ON CONFLICT DO NOTHING`
  (`repositories/authz-audit-trail.prisma.repository.ts:18-35`): *"There is no
  update path at all — a re-delivered event describes the same moment, so the
  second write must be a no-op, not an overwrite."*
- **The vocabulary.** `packages/authz/src/registry.ts` declares every resource,
  its actions and the scope tiers it is grantable at, and `roles.ts` declares the
  built-in bags as differences. Between them they *are* the role → permission
  matrix. What does not exist is the artefact: ADR-092 §1 promises
  `pnpm authz:matrix → diffable markdown table` and **no such script is in the
  repository today**. The data is there; the rendering is not.

### A listing is not a review

The Access surface lists bindings through `AccessListingRepository`
(`platform/app/src/server/app-layer/authz/repositories/access-listing.repository.ts:86-146`).
It is a good listing and a bad review, for five reasons that are all visible in
its own code and comments:

```text
  WHAT THE LISTING SHOWS              WHAT A REVIEW NEEDS
  ────────────────────────────────    ──────────────────────────────────────
  rows AT a scope                     everything that REACHES a scope
    findScopeBindings matches           an org-scoped binding reaches every
    scopeId IN (…) exactly, with        project under it; the listing never
    no ancestry walk                    walks the chain
    (access-listing.grants.
     repository.ts:218-237)

  the binding's own principal         the principal's REAL reach
    a group binding is one row          a group binding is access for every
                                        member of that group

  the key's own bindings              the key's CEILINGED access
                                        effective(key) = grants(key) ∩
                                        grants(owner) — a key bound `admin`
                                        whose owner is a viewer is a viewer

  role NAMES                          role MEANINGS
    `custom:role_2f8`                   the permission list that name stands
                                        for, as it was when reviewed

  live, non-dormant rows only         everything that grants
    "Dormant facts (lite-member,        a share link IS access to a trace;
     project-credential, platform       lite-member IS access
     grants) never surface here"
    (access-listing.repository.ts
     :22-25)
```

None of these is a defect in the listing — it exists to render five settings
pages faithfully, and the dormant-fact exclusion is a deliberate parity
decision. They are simply a different question. The review's question is the
engine's question, so the review should ask the engine.

### The as-of question, answered honestly

The tempting scope is *"who could see project chatbot on 30 June"*. We assessed
whether the ledger supports it today. It does not, and the reason is a missing
**fact**, not a missing query.

Reconstructable cheaply, right now, from Postgres alone:

- **Every grant's life.** `occurredAt` → (`expiresAt` | `revokedAt`), on a row
  that survives its own revocation. "This binding existed from 3 June to 14
  August, and ended because somebody revoked it with this reason" is one
  `SELECT`, no replay.

Not reconstructable:

1. **A grant's role is mutated in place.** `grant_role_changed` writes
   `roleKey: event.data.to` onto the same row
   (`projections/authzGrantsWrite.projection.ts:163`), and grant ids are stable
   by design — `ledger/grant-identity.ts:28`: *"`grant_role_changed` on the same
   id, not a new fact."* The projection knows the role a grant carries **now**
   and never the role it carried in June.
2. **A role's permission set is mutated in place.** `role_permissions_changed`
   replaces `Role.permissions` wholesale. A grant whose role never changed still
   resolves to a different permission set than it did, and nothing in the
   projection records the earlier set.
3. **Group membership has no history at all.** `GroupMembership` is
   `@@id([userId, groupId])` with a `createdAt` and nothing else
   (`prisma/schema.prisma:2592-2602`), and both relations are
   `onDelete: Cascade`. A removal is a hard delete. Since COLLECT unions
   `{user} ∪ groups`, a user who was in `sec-eng` on 30 June and left in July
   leaves **no trace in any table** — so an as-of answer would be *wrong*, not
   merely incomplete, and wrong in the direction that understates past access.
   That is the worst direction an audit answer can be wrong in.
4. **Offboarding hard-deletes membership and legacy team rows.** The sweep
   deletes; the audit stream remembers the event, the state does not.

Could ClickHouse close it? Partially, and not enough. `event_log` holds every
`authz_grants` event, `aggregateId = organizationId`,
`ORDER BY (TenantId, AggregateType, AggregateId, IdempotencyKey)`, partitioned
`toYearWeek(EventOccurredAt)`
(`platform/app/src/server/clickhouse/migrations/00002_create_schema.sql:15-37`),
so a role-and-grant replay is expressible. But the aggregate carries **no
group-membership event at all**, so the replay rebuilds the grants and still
cannot say who was in which group — gap (3) survives the replay. And
`event_log._retention_days` defaults to 308
(`.../migrations/00032_add_retention_and_size_columns.sql:34-38`), a horizon
shorter than a multi-year lookback.

**Verdict: no as-of reconstruction in v1.** Scope v1 to *current state plus
change history since the last review*, which is what the user-access-review
control actually tests — the reviewer certifies access **as it stands** and the
auditor tests that the review happened and that removals took effect. As-of is a
later phase with a named prerequisite (§8).

## Decision

**An access review is an export of engine answers, not a new store.** One org,
one instant, one bundle: every principal, every grant with its dates, every
role's meaning, the derived reach, and the change log since the last review. It
is produced by running the same `AuthzService` the product decides with, so a
review that disagrees with the product is a defect in one of them and never a
reconciliation exercise.

### 1. The artefact: a review bundle

A **review** is a row (`AccessReview`: id, organizationId, capturedAt,
ranByUserId, previousReviewId, status) and a bundle of files in stored objects.
The row is what makes "since the last review" mean something mechanical; the
bundle is the evidence.

```text
 review_<ksuid>/                        one organization, one instant
 ├── manifest.json     ── what this bundle IS, and what it deliberately omits
 │     reviewId · organizationId · capturedAt · ranBy
 │     previousReviewId + previousCapturedAt   (null ⇒ baseline: true)
 │     registryVersion  (content hash of registry.ts + roles.ts)
 │     counts per stream · excludedSources · auditWindowOldestRow
 │     absent: { agentSessions: "a session is not a grant, ADR-123" }
 │
 ├── principals.jsonl  ── WHO could hold anything
 │     user   { id, email, name, orgRole, disabledAt }
 │     group  { id, name, scimSource, memberUserIds[] }
 │     apiKey { id, name, ownerUserId | null }
 │              └─ null ⇒ service key: NO owner ceiling. Flagged, because
 │                 an unceilinged key is the thing a reviewer must look at.
 │     (agent sessions: none, by construction — see manifest.absent)
 │
 ├── grants.jsonl      ── WHAT was granted, and for how long
 │     grantId · principal · roleKey | resource.permission
 │     scopeType + scopeId + scopeName · source
 │     occurredAt ─────────────► began
 │     expiresAt  ─────────────► ends (stated term, nothing runs)
 │     revokedAt + revokedReason ─► ended (somebody ended it)
 │     RESOURCE rows also: resourceKind, projectId, createdByUserId,
 │                         maxViews, viewCount
 │     RESOURCE rows NEVER: token          ← §6
 │
 ├── roles.jsonl       ── what a role NAME means, at capture time
 │     built-in bags rendered from the registry · custom roles from `Role`
 │     with permissions[] and deletedAt
 │
 ├── reach.jsonl       ── the DERIVED answer, one row per (principal, scope)
 │     permissions[] · and the PATH: which grant, at which scope, through
 │     which group, under whose ceiling                      ← §3
 │
 ├── changes.jsonl     ── every access change since previousCapturedAt   ← §4
 │
 └── summary.md        ── the page a human reads and signs off on
```

**Format: JSONL per stream, plus one rendered Markdown summary.** JSONL because
the streams are not rectangular — a resource grant has four columns a binding
does not — so CSV would force either a sparse union of every column or a lossy
flattening, and both make the evidence harder to trust rather than easier. One
object per line streams out of a keyset cursor and into `jq`, DuckDB or a
spreadsheet import without anything holding a big org's grant table in memory at
either end. Not one JSON document, for the same streaming reason. The summary is
Markdown rather than PDF because it is a diff-able artefact stored beside the
data it summarises; signature and approval live in the customer's own process
(§8).

The bundle is **self-describing on purpose**. `registryVersion` is what makes
`roles.jsonl` more than decoration: a reviewer reading a bundle from March must
be able to tell whether `admin` meant then what it means now. There is no version
constant in `packages/authz/src/registry.ts` today; this ADR adds one, computed
as a content hash of the registry and the role bags so it cannot be forgotten
when a resource is added.

### 2. The query surface, and the permission that gates it

Two shapes over one engine, both on the Access surface, neither ops-only:

- **`accessReview.reach`** — *"who can reach project chatbot"*. Interactive, one
  scope, answers immediately, sits next to the existing bindings table where the
  question is asked.
- **`accessReview.export`** — the whole-org bundle. A job (§7), not a request.

An ops-only export was rejected. The people who run access reviews are the
customer's own security and compliance staff, and a control that requires a
LangWatch operator to produce its evidence is a control the customer cannot
operate — it also puts us in the loop of every audit, quarterly, per customer.

**Gate: `auditLog:view`.** `reach` requires it at the scope being asked about;
`export` requires it bound at **organization** scope, because the bundle
enumerates every principal in the organization and a project-scoped holder must
not be able to do that. The registry already declares `auditLog` as read-only
across project/team/organization (`registry.ts:105-108`), it is already in the
`ORG_ADMIN` bag, and `platform/app/src/server/api/routers/organization.ts:78-98`
already implements exactly the "org-scoped OR project-scoped `auditLog:view`"
check this needs — that pattern is reused, not re-invented.

Three alternatives, and why not:

- **`organization:manage`** — a write permission. An auditor, a compliance
  engineer or a security reviewer must be able to read the account without being
  able to change it. Gating evidence on a write permission forces every reviewer
  to become an admin, which inverts the point of the review.
- **`complianceExport:view`** — exists, is org-scoped and read-only, and means
  something else. The codebase states its meaning in its own words: *"bulk
  export of an org's data is egress, not access"*
  (`platform/app/src/server/app-layer/langy/langyPermissionPolicy.ts:199`). A
  review bundle contains no traces, no prompts, no messages — it is access
  metadata. Overloading the two would let a customer who granted data egress
  also enumerate their access graph, and the reverse. Two risks, two permissions
  that already exist; keep them apart.
- **A new `accessReview` resource** — costs a registry entry, a role-bag
  decision across four built-in tiers, a presentation entry, and a decision for
  every one of the 464 custom roles in production about whether they gain it.
  `auditLog:view` already means *"you may read the record of who did what
  here"*, and *"who can do what here"* is the same reader's question. If a
  customer later needs them separated, that is a registry entry then.

### 3. "Who can reach X" is `effectivePermissions`, run for other principals

The one genuinely new capability. `effectivePermissions` answers for the caller
only (`routers/authz.ts:8-12`); the review needs it for every principal. The
derivation is the same call with the principal varied, and the answer carries
the path:

```text
  who can reach project "chatbot"?
      │
      ▼
  for each principal P in principals.jsonl:
      COLLECT once      ← one DB read per principal (the expensive part)
      then for each scope S the review covers:
        effectivePermissions(P, S)   ← pure CPU over the collected set
      │
      ▼
  reach row: { principal, scope, permissions[], via[] }

  via[] names the PATH, not just the verdict — the four ways in:
    { kind: "direct",   grantId, roleKey, scope }
    { kind: "group",    groupId, groupName, grantId, roleKey, scope }
    { kind: "key",      apiKeyId, ownerUserId, ceilingApplied: true|false }
    { kind: "resource", grantId, permission, expiresAt, maxViews, viewCount }
```

`via[]` is `explain()`'s matched-binding data
(`packages/authz/src/engine.ts:145-214`) kept rather than discarded. A reviewer
who reads "alice can view traces in chatbot" and cannot see *why* has to go and
find out, and that hunt is the manual work the review is supposed to abolish. It
is also what makes the answer falsifiable: a path that names a grant id can be
checked against `grants.jsonl`.

Cost shape, and why the export is affordable: COLLECT is per principal and is the
only database work; every `decide` after it is a pure function over the
already-collected set (ADR-092 §2). So a bundle is O(principals) reads and
O(principals × scopes × permissions) in-memory decisions. The export must reuse
`AuthzService`'s per-organization epoch cache rather than re-collecting per
scope — collecting per (principal, scope) would multiply the only expensive part
by the scope count for no gain.

**"Who can see PII" means "who holds the permissions that reach that data".**
Said precisely, because the free-list entry's phrasing invites a stronger
reading than the engine can support. The engine does not know which spans
contain personal data and this ADR does not give it an opinion. What the
registry knows is that a resource *is* a category of data — `traces`,
`annotations`, `datasets`, `prompts`, `secrets`, `gatewayLogs` — so a review
question is asked as a permission set (*"everyone who resolves `traces:view` at
or above project chatbot"*) and the answer is exact **for that question**.
Whether `traces` in chatbot contains PII is a classification question owned by
the data-privacy surface, and pointing the review at a permission set rather
than a classification is what keeps the answer verifiable rather than plausible.
The summary says this in its own words, so nobody reads more into it.

### 4. Change history: the insert-only trail is the diff

"Since the last review" is mechanical, not interpretive: every `AuditLog` row
whose `action` begins `authz.grants.` (`schemas/constants.ts:73`) with
`createdAt` in `(previousReview.capturedAt, thisReview.capturedAt]`.

That window is trustworthy for one specific reason: the sink is insert-only, the
row id is derived from the event id, and re-delivery is `ON CONFLICT DO NOTHING`
(`authz-audit-trail.prisma.repository.ts:18-35`). Re-running an export over the
same window produces the same rows, byte for byte, and no row can be edited
after the fact. That is exactly what an auditor is testing when they ask whether
the change log can be tampered with.

The first review of an organization has no base. It is marked `baseline: true`,
its `changes.jsonl` is empty, and the summary says why — rather than showing an
empty change list that reads as "nothing changed".

Two omissions are stated in the manifest rather than hidden:

- **Migration and read-through-mint are not audited.** `NON_AUDITABLE_SOURCES`
  (`authzAuditTrail.subscriber.ts`) excludes them deliberately — they are
  backdated history, not changes anybody made, and auditing them would fill the
  customer's audit page with thousands of rows for nothing. The consequence for a
  review is that a grant which arrived by migration appears in `grants.jsonl`
  with `source: "migration"` and has **no matching change row**. The manifest
  lists the excluded sources so this reads as a stated rule rather than a hole.
- **The window can be older than retention.** The manifest carries both the count
  of rows found and the `createdAt` of the oldest `authz.grants.` row in the
  table, so *"no changes in the period"* and *"no history for the period"* cannot
  be confused. Distinguishing those two is most of what the manifest is for.

### 5. The registry matrix, versioned

ADR-092 §1 promised `pnpm authz:matrix` and it was never built. It is built here,
because without it `roles.jsonl` is a list of names. The generator renders the
registry and the role bags to a diffable Markdown table checked into
`dev/docs/`, and the same pure function produces `roles.jsonl` and
`manifest.registryVersion`. One derivation, three outputs: the checked-in doc
drifting from a bundle becomes impossible rather than merely unlikely.

### 6. Share links: the row is the evidence, the token is not

A resource grant is real access to a trace or a thread, so it belongs in the
review — and its `token` never leaves storage. Possession is the whole security
property (ADR-057, carried into `Grant.token` as a globally unique column
precisely so revocation bites), and an export that carried tokens would turn the
compliance artefact into the most dangerous file in the organization. It would
also travel: bundles go to auditors, into ticketing systems, into shared drives.

The evidence is the row's **existence and terms**: who minted it
(`createdByUserId`), for which resource (`resourceKind`, `scopeId`, `projectId`),
what it grants (`permission`), when it ends (`expiresAt`), and how much of its
budget is spent (`maxViews` against `GrantUsage.viewCount`). A reviewer deciding
"this link should not exist" needs the grant id to revoke it, never the token to
use it. The bundle carries the grant id.

This is a hard rule with a test, not a convention: nothing in any bundle stream
may contain a `token` field, and the spec binds it.

### 7. The flow, and big organizations

```text
   ClickHouse event_log  ──► fold ──► Postgres projections
   (aggregate authz_grants,           Grant · Role · GrantUsage
    the source of truth)                   │
            │                              │        ┌── Group / GroupMembership
            └──► audit subscriber          │        ├── OrganizationUser
                 (insert-only)             │        └── ApiKey (+ owner)
                      │                    │              │
                      ▼                    ▼              ▼
                  AuditLog          ┌──────────────────────────┐
                      │             │   AuthzCollectorService  │  COLLECT
                      │             │   AuthzService           │  DECIDE
                      │             │   (the SAME instance the │
                      │             │    product decides with) │
                      │             └──────────────────────────┘
                      │                          │
                      │                          ▼
                      │                  effectivePermissions(P, S)
                      │                  + explain() paths
                      ▼                          ▼
              changes.jsonl            principals · grants · roles · reach
                      └───────────┬───────────────┘
                                  ▼
                         review bundle (stored objects)
                                  │
                   ┌──────────────┴──────────────┐
                   ▼                             ▼
             summary.md                    accessReview.reach
             (signed off by a human)       (the same query, one scope,
                                            answered interactively)

   The export NEVER reads ClickHouse. Neither does a check (ADR-092 §13).
   Same reader, same answer — which is what makes disagreement a defect.
```

**The export is a job.** `accessReview.export` creates the `AccessReview` row and
returns its id; a worker pages the projection with a keyset cursor on
`(organizationId, id)`, writes each stream as JSONL into stored objects through
the path the other exports already use, and marks the row complete. The caller
polls the row and downloads. A tRPC request must not hold a reach computation
over thousands of principals, and a bundle that has to be regenerated to be
re-read is not evidence — it has to be a file that stays put.

Failure is a `HandledError` with a stable `code`, `fault: "platform"` (a bundle
we could not produce is our defect, never the admin's), and the partial bundle is
discarded rather than published: half a review reads as a complete one.

### 8. What this deliberately does not do

- **No as-of-date reconstruction.** The verdict and its four anchors are in
  Context. The later phase has a named prerequisite and this ADR does not take
  it: group membership must become ledger facts on the `authz_grants` aggregate
  (`group_member_added` / `group_member_removed`), and a role's permission change
  must produce an addressable version rather than replacing a column. Neither is
  expensive; both are migrations, and making v1 wait on them would trade an
  artefact customers can use this quarter for one they can use next year.
- **No attestation workflow.** No assign-to-a-reviewer, no approve, no sign-off
  state machine, no reminder emails. Those are process tooling, they are the part
  every GRC platform already sells, and building them here would put us in the
  business of workflow rather than evidence. The bundle is designed to be
  *imported* by that tooling — which is most of why the streams are JSONL and the
  summary is a file. A later layer can add attestation on top of an artefact that
  already exists; it cannot be usefully built first.
- **No PII classification of data.** §3 states the exact claim. The review
  answers a permission question and says so.
- **No new store of access facts.** Nothing here writes a grant, a role, or an
  audit row. The one new row is the `AccessReview` marker, which records that a
  review happened and when — it is metadata about the review, not about access.
- **No agent sessions.** ADR-123 settles it: a session is composed for one turn
  and stored nowhere, so there is nothing to list and nothing to grant to. An
  agent appears in a bundle **once, as a role**, exactly as
  `specs/rbac/agent-principals.feature` already specifies. The manifest names the
  absence rather than leaving a reviewer to wonder whether we forgot.

## Rationale / Trade-offs

**Why derive rather than accumulate.** The alternative is a review store: a
nightly snapshot of who-can-do-what, queried at review time. It answers as-of
dates, which is the thing v1 gives up. It is rejected because a snapshot is a
second source of truth about access, and a second source of truth about access is
exactly the class of bug ADR-092 was written to end. A snapshot that drifts from
the engine produces an audit artefact that is *confidently wrong*, and nobody
finds out until an auditor does. Deriving from the engine means the review and the
product cannot disagree; if they ever do, the offboarding proof already
demonstrates the right response — fail loudly.

**Why the bundle is big and boring.** A bundle for our own organization will
contain tens of thousands of reach rows. That is fine and intended: the artefact
is machine-readable evidence with a human summary on top, not a report. The
summary is where judgment lives — unceilinged service keys, grants whose
`expiresAt` has passed, admin bindings with no recent activity, share links with
budget remaining — and the JSONL is what an auditor greps when they disbelieve
the summary.

**Why `auditLog:view` and not a new permission.** Discussed in §2. The cost of the
wrong answer is asymmetric: a permission we add and later regret is in 464 custom
roles and cannot be removed, whereas a permission we reuse and later need to split
is one registry entry and a migration we would have had to write anyway.

**What we accept.** A review reflects the moment it was captured, so an access
granted and revoked entirely between two reviews shows in `changes.jsonl` and not
in `grants.jsonl` — the change log is what makes the pair complete, and it is why
the bundle carries both rather than either. Grants imported by migration have
state but no change row (§4). And the reach computation is a point-in-time read
against a live system: a grant attached while the export runs may land in
`grants.jsonl` and not in a reach row computed a second earlier. The manifest
carries `capturedAt` and the export fences its reads on it, so the window is
declared rather than pretended away.

## Consequences

- The Access surface gains a second question. Today it answers *"what bindings
  exist"*; it will also answer *"who can reach this, and how"* — and the second
  question is the one people actually ask in Slack.
- `effectivePermissions` gains a caller that passes a principal other than the
  session user. That is a real widening of a sensitive surface and it is gated at
  the router, not in the service: the service stays a pure query and the
  permission check lives where every other one does.
- The registry gains a version. Adding a resource changes it, which is correct —
  a bundle produced before the change must not claim the vocabulary of one
  produced after.
- `pnpm authz:matrix` finally exists, closing an ADR-092 §1 promise, and the
  checked-in matrix becomes reviewable in pull requests: a role bag that quietly
  gains a permission shows up as a documentation diff.
- Offboarding gets a second consumer of its proof. If a bundle ever lists an
  offboarded person with access, the offboarding proof and the review disagree,
  and exactly one of them is broken. The spec makes that a scenario rather than a
  hope.
- Nothing in the hot path changes. No check reads anything new; the export runs
  off the same projections a check reads and never touches ClickHouse.

## References

- ADR-092 §1 (registry + matrix codegen), §6 (`explain`), §10 (offboarding with
  proof), §13 (the grants ledger, the audit subscriber), and the free-list entry
  *Access reviews / SOC 2 evidence* —
  `dev/docs/adr/092-unified-authorization-engine.md`.
- ADR-110 (grant aggregates; `occurredAt` / `acceptedAt`, deterministic ids).
- ADR-123 (a session is not a grant) —
  `dev/docs/adr/123-an-agent-session-is-a-principal.md`.
- The shipped proof: `packages/authz-server/src/offboard.ts:49-122`.
- The pure query: `packages/authz-server/src/authz.service.ts:138-163`; today's
  caller-only surface: `platform/app/src/server/api/routers/authz.ts:13-44`.
- The paths: `packages/authz/src/engine.ts:145-214` (`explain`,
  `explainBindingLine`);
  `platform/app/src/server/app-layer/authz/denial-explanation.ts`.
- What the listing does and does not carry:
  `platform/app/src/server/app-layer/authz/repositories/access-listing.repository.ts:22-25,86-146`;
  `access-listing.grants.repository.ts:218-237`.
- State with its dates: `platform/app/prisma/schema.prisma:2649-2762`
  (`Grant`, including the revoke-marks-the-row comment at `:2712-2720`, the
  `expiresAt` comment at `:2691-2706`, and `GrantUsage`), `:2592-2602`
  (`GroupMembership` — the missing history), `:353-375` (`OrganizationUser`).
- In-place mutation, the as-of blocker:
  `platform/app/src/server/event-sourcing/pipelines/authz-grants/projections/authzGrantsWrite.projection.ts:163`;
  `packages/authz-server/src/ledger/grant-identity.ts:19-28`.
- The change log:
  `.../pipelines/authz-grants/subscribers/authzAuditTrail.subscriber.ts`
  (`AUTHZ_AUDIT_EVENT_TYPES`, `NON_AUDITABLE_SOURCES`);
  `.../schemas/constants.ts:73-85`;
  `platform/app/src/server/app-layer/authz/repositories/authz-audit-trail.prisma.repository.ts:18-35`.
- The event store and its horizon:
  `platform/app/src/server/clickhouse/migrations/00002_create_schema.sql:15-37`;
  `.../00032_add_retention_and_size_columns.sql:34-38`.
- The vocabulary: `packages/authz/src/registry.ts:29-215` (`auditLog` at
  `:105-108`, `complianceExport` at `:163-166`); `packages/authz/src/roles.ts`
  (`ORG_ADMIN`, `complianceExport:view` at `:151`); the meaning of
  `complianceExport`:
  `platform/app/src/server/app-layer/langy/langyPermissionPolicy.ts:199`.
- The reusable org-or-project permission check:
  `platform/app/src/server/api/routers/organization.ts:78-98`.
- Spec: `specs/rbac/access-reviews.feature` (this ADR). Contracts it must not
  contradict: `specs/rbac/agent-principals.feature` (a standing review lists no
  assistant sessions), `specs/rbac/expiring-grants.feature`,
  `specs/rbac/authz-grants.feature`, `specs/rbac/denial-explanations.feature`,
  `specs/rbac/unified-authorization-engine.feature`.
