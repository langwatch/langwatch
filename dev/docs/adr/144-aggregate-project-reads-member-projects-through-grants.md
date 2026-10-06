# ADR-144: An aggregate project reads its member projects through shared grants

**Date:** 2026-09-26, revised 2026-10-06

**Status:** Accepted (v4, 2026-10-06)

**Builds on:** ADR-166 (grant-scoped data access: a sealed `Authorization`
proof minted once at the door, carried by hand, applied by the store client),
ADR-092 (the grants ledger and the resolver walk), ADR-110 (a grant is an
aggregate), ADR-143 (the Developer seat, point 5: traces appear in a shared
project once "project may read project" lands), ADR-142 (the query API
already reads several projects under one key).

**Related:** ADR-018 (governance as one observability substrate), ADR-038
(governance and LLM ops are two intents on one platform), ADR-057 (share
links are the only beyond-audience exposure today), tasks#904 (cross-project
query in the product), tasks#867 (two-project organisation key e2e), PR 7536
(the feature-layout branch that carries ADR-166 as a decision and no code).

> One-line: a **governance project** is a normal project of kind
> **`aggregate`** that owns no traces. A stored **scope rule** names its
> **member projects**; a reconciler materialises the rule into one
> **shared `project-reader` grant** per member in the grants ledger. Every
> trace read mints one **`Authorization` proof** (ADR-166) that lists the
> aggregate as an own grant and each member as a shared grant, and the
> ClickHouse client adds the tenant set from that proof. Only **organisation
> admins** may open it, every visit is **audit-logged** the way admin
> workspace views are today, and the **strictest member privacy policy**
> applies.

## Context

Leadership wants a company-wide view of traces, starting with the personal
projects that coding agents write into. Agents increasingly call agents in
other projects, so a single trace crosses project lines and today's reader
sees half of it. The hidden per-organisation governance project
(`Project.kind = "internal_governance"`) copies ingestion-source data into a
second tenant, is unroutable by design, and is excluded by fifteen filters.
It was never meant to be opened as a project.

Picking member projects one by one does not scale: every sign-up creates a
personal project that would need adding by hand. The view needs a rule, not
a list, and the rule must keep applying as projects appear and people move
between departments.

Nothing on `main` lets one project read another. The grants ledger refuses a
`project` principal on any project but its own
(`platform/app/src/server/event-sourcing/pipelines/authz-grants/schemas/events.ts`,
`grantShapeRefinement`). Every trace read hard-codes one tenant
(`trace-list.clickhouse.repository.ts`, `trace-summary.clickhouse.repository.ts`,
`span-storage.clickhouse.repository.ts`, twenty call sites in
`routers/tracesV2.ts`). Any `projectId` that reaches a repository is trusted.

ADR-166 decides the shape that fixes the second half of this: a sealed
`Authorization` proof is minted once at the route by `authz.authorize`,
travels as a named parameter, and the store client adds
`TenantId IN (own ∪ shared)` plus each shared grant's condition. Repositories
never write a tenant again. ADR-166 is Accepted on the PR 7536 branch and
has no code there: no `Authorization` type, no `.as(authorization, …)`
client, no `findReaders`, no grant condition column (verified 2026-10-06 by
searching that branch for every name the ADR introduces). So this decision
builds the thin slice of ADR-166 that an aggregate needs, on `main`, using
ADR-166's names, so the later move into the feature layout is a move and not
a rewrite.

v2 of this decision (2026-09-26) threaded a `tenantIds[]` list through every
repository instead. v3 replaces that with the ADR-166 proof. A per-repository
list would have left twenty hand-written tenant sites in place and given
later callers no proof to reuse.

Constraints confirmed for this decision:

- Data is stored once, in the project that received it. The aggregate never
  copies or re-ingests a trace.
- The aggregate is a real project with its own id, created from the LLM ops
  "new project" flow, not from governance settings.
- Reuse the grants ledger. No parallel access table.
- The hidden `internal_governance` project is untouched and is never a
  member.
- Nothing is hard-coded: the member set comes from a rule, and every read
  carries proof of who asked and what they may reach.

## Building blocks

The work splits into seven blocks. Each has its own tests and commits. Blocks
A, B and D have no dependency on each other and start first.

| Block | What it delivers | Needs | ADR-166 home after the port |
|---|---|---|---|
| A | A grant may be **shared** from one project to another, carrying a `condition` (type, from, until, and a `where` slot left empty in v1) | | `modules/authz/contract`, `modules/authz/process` |
| B | `authz.authorize` mints a sealed `Authorization` proof at the route; it travels as the named parameter `authorization` | A | `@langwatch/actor` (type), `modules/authz/process` (mint) |
| C | The ClickHouse client applies the proof: `clickhouse.as(authorization, { reads: "traces" })` adds the tenant set and the window; trace repositories write no `TenantId` | B | `packages/clickhouse-client`, `modules/trace/process` |
| D | `Project.kind = "aggregate"` with `Project.aggregateRule`; admin only; owns no credential, no ingest, no prompts, experiments or monitors | | `modules/project`, governance enterprise module |
| E | Reconciler turns the rule into block A grants and keeps them true on four triggers | A, D | governance enterprise module via the authz commands |
| F | Trace list, detail, summary and analytics routes mint the proof and stop passing `projectId` below the door | B, C | `modules/trace` transports |
| G | Strictest member privacy policy; the existing five-minute admin view audit row, with a new kind `aggregate` | B | governance enterprise module |

Left for later with the slot kept: the OTTL `where` compiler, signed baggage
on ingest, `findReaders` for evaluation fan-out, and `prisma.as(authorization)`
on the Postgres side.

## Decision

1. **A new project kind, `aggregate`.** `Project.kind` is already a free-form
   string, so no migration is needed for the kind itself. An aggregate project
   is created through the existing `project.create` tRPC path with
   `kind: "aggregate"` and a scope rule. It attaches to a team like any
   project. We reject a separate `AggregateProject` table because the
   project id is what every trace route, nav item and permission check
   already keys on; a new table would need its own routing, guards and
   pickers. (Block D.)

2. **The scope rule is stored on the project, as data.** A new nullable
   column `Project.aggregateRule` (JSON) holds one of three shapes:
   `{ kind: "all-personal" }`, `{ kind: "personal-by-department",
   departmentId }`, or `{ kind: "explicit", projectIds: [...] }`. The default
   on creation is `all-personal`. Any project in the organisation may be
   named by an explicit rule, including other people's personal projects,
   because only organisation admins can open the aggregate (choice 5).
   Department membership is read from the owner's current
   `OrganizationUser.departmentId`; history is ignored in v1. (Block D.)

3. **One shared `project-reader` grant per member, materialised by a
   reconciler.** The rule is not evaluated at read time. A reconciler
   resolves the rule to the current member set and emits `grant attached`
   and `grant revoked` events so the ledger holds exactly one live row per
   (aggregate, member) pair: principal `PROJECT` = the aggregate, scope
   `PROJECT` = the member, `roleKey = "project-reader"`,
   `source = "aggregate-reconciler"`, and a `condition` of
   `{ type: "trace", from: <attach time>, until: null }` with no `where`.
   Grant ids are deterministic KSUIDs derived from the pair, so a replay or
   a repeated run is idempotent. The reconciler runs on four triggers: rule
   created or edited, personal workspace created or reactivated, department
   assigned, and a nightly sweep per organisation that catches anything the
   triggers missed. We choose materialisation over read-time evaluation
   because the grant row is the thing ADR-143, tasks#904 and ADR-166's
   `findReaders` reuse; a read-time rule would give those callers nothing.
   (Blocks A and E.)

4. **The grant shape refusal is lifted for this one shape only.**
   `grantShapeRefinement` gains one legal placement for a `project`
   principal on a foreign project: `roleKey === "project-reader"`, both
   projects in the same organisation, and a `condition` present. Every other
   foreign placement, every team or organisation placement and every other
   role key stay refused. `project-reader` is a built-in role whose whole
   permission list is `traces:view` and `analytics:view`. It never carries
   `*:manage`, and it never applies to a user or API-key principal. The
   `where` field of the condition is accepted only when empty in v1; a
   non-empty `where` is refused until the OTTL compiler lands. (Block A.)

5. **Only organisation admins may open an aggregate project.** The project
   route guard (`project.service.ts` route guard, `routers/project.ts`)
   refuses any caller who is not an organisation admin when the target kind
   is `aggregate`, regardless of team membership. The Developer seat and
   every non-admin member see nothing. We reject "anyone on its team"
   because it turns a team add into a silent read grant over other people's
   personal data, and we reject "only what the viewer could read anyway"
   because it cannot deliver a company-wide view. (Block D.)

6. **Every trace read carries an ADR-166 `Authorization` proof, and the
   store client adds the tenant set.** A trace route calls
   `withPermission("traces:view")`, which asks `authz.authorize({ principal,
   permission, scope: { projectId } })` and receives a sealed proof: the
   actor, the principal, the organisation, one `own` grant for the aggregate
   with the caller's full permission set, one `shared` grant per live
   `project-reader` row with the single permission, its `via` grant id and
   its `condition`, an `expiresAt` equal to the earliest grant expiry, and
   `purpose: "route"`. The proof is passed by hand as the named parameter
   `authorization` from route to service to repository. The repository calls
   `this.clickhouse.as(authorization, { reads: "traces" })` and writes no
   `TenantId`. The client refuses a missing, forged or expired proof, or one
   that does not cover the named resource, with a named error and no row
   data in the log, and otherwise ANDs
   `TenantId IN (own ∪ shared) AND (TenantId IN own OR (TenantId IN shared
   AND StartTime within the grant's window))` onto the query. A trace from a
   project outside the proof contributes nothing. Member traces are
   first-class rows in the list and link to their own detail page under the
   aggregate's slug, carrying the owning project id for display; the detail
   read does not use it to pick a tenant. (Blocks B, C and F.)

7. **The aggregate owns no traces and no credential.** `Project.apiKey`
   stays populated because the column is required, but the ingest routes,
   the virtual-key destination resolver, the CLI project picker and the
   ingest-key mint all refuse or hide kind `aggregate`. The key is never
   displayed. Billing counts stay with the owning project; the aggregate's
   trace count is always zero. (Block D.)

8. **Read only in v1: no online evaluations run from the aggregate.** The
   list and detail show the owner's existing evaluation results. No monitor
   can be created on an aggregate, and the evaluation trigger subscriber is
   untouched. Online Evals, Test and Build are hidden from the aggregate's
   navigation; Observe shows Analytics and Traces. Annotations on member
   traces are out of scope. (Block D.)

9. **Strictest member privacy policy, audited like admin workspace views
   today.** The effective privacy policy of an aggregate read is the most
   restrictive across the own and shared grants in the proof, matching the
   query API precedent. Any read of the aggregate (list, detail, summary,
   analytics) writes one row through the existing
   `AdminWorkspaceViewAuditService` with a new kind `aggregate`, deduplicated
   per actor and aggregate for five minutes, exactly as personal and team
   workspace views are audited now. A per-trace `trace.viewed` row naming
   the `via` grant (ADR-166's shape) is deferred: the proof already carries
   the grant id, so the slot is kept. (Block G.)

10. **Build on `main`, port into the feature layout.** The seven blocks ship
    on `main` under ADR-166's names: `Authorization`, `authorize`,
    `as(authorization, { reads })`, `kind: "own" | "shared"`, `via`,
    `condition`, `purpose`, the four named errors. When PR 7536 lands, each
    block moves to the home named in the table above with its tests. Nothing
    is renamed in the port.

11. **Shared primitive, first caller.** Blocks A, B and C are shared. Blocks
    D, E, F and G belong to this caller. ADR-143 (shared project reads a
    personal project) and tasks#904 (cross-project charts) attach their own
    shared grants with the same role key and reuse the proof.

## Constants

| Name | Value | Purpose |
|---|---|---|
| `PROJECT_KIND_AGGREGATE` | `"aggregate"` | `Project.kind` value |
| `PROJECT_READER_ROLE_KEY` | `"project-reader"` | `Grant.roleKey` for a project-to-project read grant |
| `PROJECT_READER_PERMISSIONS` | `["traces:view", "analytics:view"]` | the role's whole permission list |
| `GRANT_SOURCE_AGGREGATE_RECONCILER` | `"aggregate-reconciler"` | added to `GRANT_EVENT_SOURCES` |
| `GRANT_CONDITION_TYPES` | `"trace" \| "span" \| "log"` | `Grant.condition.type`; v1 writes only `"trace"` |
| `AUTHORIZATION_GRANT_KINDS` | `"own" \| "shared"` | ADR-166 grant kind inside the proof |
| `AUTHORIZATION_PURPOSES` | `"route" \| "event" \| "operator"` | ADR-166 purpose; v1 mints only `"route"` |
| `CLICKHOUSE_READ_RESOURCES` | `"traces" \| "spans" \| "analytics"` | the `reads` declaration on `as()` |
| `AGGREGATE_RULE_KINDS` | `"all-personal" \| "personal-by-department" \| "explicit"` | discriminator of `Project.aggregateRule` |
| `AGGREGATE_DEFAULT_RULE` | `{ kind: "all-personal" }` | preselected on creation |
| `ADMIN_WORKSPACE_VIEW_DEDUP_MS` | `300000` (5 × 60 × 1000) | existing list-view audit dedup window, reused |
| `AGGREGATE_RECONCILE_SWEEP` | nightly, per organisation | catch-up for missed triggers |

## Invariants

| Invariant | Meaning | Test anchor |
|---|---|---|
| Foreign placement stays refused | Only `project-reader` with a condition on a same-organisation project lifts the refusal | `authz-grants/schemas/events.test.ts`: every other foreign placement, team placement, organisation placement, role key and non-empty `where` is refused |
| Read grants never escalate | `project-reader` satisfies only `traces:view` and `analytics:view` | `packages/authz` matcher test: `traces:manage`, `project:manage`, `prompts:view` all denied through a `project-reader` grant |
| Proof is sealed | A proof built outside `authz.authorize` is refused by the client | `ForgedAuthorizationError` unit test |
| Proof expires | A proof past `expiresAt` is refused; a revoked grant is absent from the next mint | `AuthorizationExpiredError` test; revoke-then-mint test |
| No leak outside the proof | A tenant not named in the proof returns zero rows from every ClickHouse trace read | integration test per repository: list, summary, spans, analytics with a foreign tenant holding rows |
| Repositories write no tenant | No trace repository query text contains `TenantId`; the client adds it | lint rule `store-call-carries-authorization` scoped to the trace repositories, plus a grep assertion in the repository tests |
| Same organisation only | A member project in another organisation is never attached | reconciler test; refinement test; `TenantMismatchError` on a cross-organisation proof |
| Hidden governance project never a member | `internal_governance` is excluded by every rule kind | reconciler test |
| Admins only | A non-admin, including a Developer seat, is refused at the route guard and the tRPC guard | `projectFilter.invariant.integration.test.ts` extension plus guard unit test |
| Reconciler is idempotent | Two runs, or a replay, produce the same grant ids and no duplicate rows | reconciler test comparing ledger state after two runs |
| Rule changes converge | Removing a project from an explicit rule revokes its grant; a new personal project under `all-personal` is attached on creation | reconciler trigger tests |
| Data stored once | The aggregate's own tenant id holds zero spans; billing counts unchanged | ingest route test returns 403 for kind `aggregate`; `trace-usage.service` test unchanged |
| Every visit is audited | Any aggregate read writes one admin view audit row of kind `aggregate`, deduplicated for five minutes | audit service test |
| Strictest policy wins | With members at policies A (loose) and B (strict), the aggregate read applies B | privacy policy read test |
| Plain projects unchanged | A plain project's trace list through the new path returns the same rows as before | golden test on an existing fixture |

## Assumptions

| Assumption | What breaks if false |
|---|---|
| Every member of one aggregate lives in the same organisation, so ClickHouse routing resolves to one endpoint | Reads would need cross-endpoint fan-out and merge; the same-organisation refinement makes this a hard rule |
| `Project.kind` is only ever read for the `internal_governance` filter today | A reader that assumes "not internal_governance means application" would treat an aggregate as a normal project; the sweep in block D lists every `kind` read |
| Personal project owners carry their department on `OrganizationUser.departmentId` and nowhere else | A department set on `Team` or `Project` but not on the user would be ignored by the by-department rule |
| Grant ids are deterministic KSUIDs derived from event content | Reconciler idempotency would depend on a lookup before each emit |
| ADR-166's names are stable until PR 7536 lands | The port becomes a rename as well as a move |
| The ClickHouse client wrapper is the single choke point for trace reads | A repository that bypasses the wrapper keeps its hand-written tenant and escapes the lint |

## Gates

| Path | Reversible? | Blast radius | Required gate |
|---|---|---|---|
| Lift the foreign-project refusal in `grantShapeRefinement` | No: grants are ledger facts | Large: security boundary | Human review on the PR plus the "foreign placement stays refused" unit test; the PR does not merge without both |
| Client applies the proof to ClickHouse trace reads | Yes | Large: tenant leak | Automated: "no leak outside the proof" integration test per repository; "plain projects unchanged" golden test; apidiff negative tests stay green |
| Repositories stop writing `TenantId` | Yes | Large: a missed site reads one tenant by hand and skips the proof | Automated: lint rule `store-call-carries-authorization` on the trace repositories, failing CI |
| `Grant.condition` and `Project.aggregateRule` migrations | Yes | Small | Each ships with a tested down path (drop column) |
| `project-reader` built-in role | Yes | Large: permission surface | Automated: matcher test proving the permission list is closed |
| Route and tRPC guard for admins only | Yes | Large: personal data exposure | Automated: guard tests for admin, member, Developer seat, external |
| Reconciler emitting ledger events | Partly: revocation marks rows | Medium | Automated: idempotency and convergence tests; nightly sweep as detection |
| Ingest refusal for kind `aggregate` | Yes | Small | Automated: route test |
| Admin view audit row of kind `aggregate` | Yes | Medium: compliance evidence | Automated: service test |
| Navigation hiding Test, Build, Online Evals | Yes | Small | None; detection by the UI contract spec |

## Schema

```prisma
model Project {
  // ...
  /// Project kind gains:
  ///   - "aggregate": a project that owns no traces and reads its member
  ///     projects through shared project-reader grants (ADR-144). Hidden
  ///     from every "send traces here" picker and from ingestion; visible in
  ///     the project switcher to organisation admins only.
  kind          String @default("application")
  /// ADR-144: the scope rule an aggregate project materialises into grants.
  /// Null on every other kind. Shapes: { kind: "all-personal" } |
  /// { kind: "personal-by-department", departmentId } |
  /// { kind: "explicit", projectIds: string[] }.
  aggregateRule Json?
}

model Grant {
  // ...
  /// ADR-166 / ADR-144: what a shared grant lets the principal reach.
  /// Null on own grants. Shape: { type: "trace" | "span" | "log",
  /// where?: string (OTTL, empty in v1), from?: ISO date, until?: ISO date }.
  condition     Json?
}
```

Migrations: `ALTER TABLE "Project" ADD COLUMN "aggregateRule" JSONB;` and
`ALTER TABLE "Grant" ADD COLUMN "condition" JSONB;`, each with a drop-column
down path. The grant row otherwise uses existing columns (`principalType =
PROJECT`, `scopeType = PROJECT`, `roleKey = "project-reader"`, `source =
"aggregate-reconciler"`).

## Rejected alternatives

- **A `tenantIds[]` parameter on every repository (v2 of this decision).**
  Leaves twenty hand-written tenant sites, gives later callers no proof,
  and would be rewritten when ADR-166 lands.
- **Wait for PR 7536 to carry ADR-166's code.** It carries the decision
  only; the aggregate would wait on a 41,000-file refactor for a thin slice
  it can build and port.
- **Plain `AggregateProject` or membership table.** Second access model next
  to the ledger; ADR-143 and tasks#904 would get nothing from it.
- **Read-time rule evaluation with a per-organisation cache.** Cheap to build,
  but access would depend on cache age and no other caller could reuse it.
- **Wildcard scope ids in the ledger ("personal project *").** Breaks the
  matcher's id anchor and every index on `scopeId`; the rule-to-rows
  reconciler gives the same user-facing behaviour.
- **Open the hidden `internal_governance` project as the view.** It is a
  routing artefact excluded by fifteen filters and owns ingestion data, not
  application traces.
- **Anyone on the aggregate's team may read it.** A team add would silently
  grant reads over other people's personal data.
- **Only what the viewer could already read.** Safe but cannot deliver the
  company-wide view that is the point.
- **Owners share their own project into the aggregate.** Matches ADR-166's
  example of a team sharing to everyone, but a company view that depends on
  each owner clicking share is not a company view; the admin's rule attaches
  the grants on the admin's behalf, and the owner's share flow can reuse the
  same grant later.
- **Ambient proof via async context.** ADR-166 ruling: the proof travels by
  hand so a missing one is a type error, not a runtime surprise.
- **Run the aggregate's online evaluations on member traces in v1.** Doubles
  evaluation cost per trace and needs `findReaders`; deferred.
- **One audit row per trace opened, naming the grant.** ADR-166's shape and
  the better compliance answer, but no read in the product is audited per
  row today, and it adds a write to every trace detail request. Deferred;
  the proof carries the grant id so the row can be added without a schema
  change.
- **Per-row privacy policy.** Correct per trace but mixes redaction levels in
  one list and slows the query; strictest-wins matches the query API.
- **Aggregate with its own API key and traces.** Muddies "data stored once"
  and forces the aggregate into every key picker and billing path.

## Consequences

Positive: one shared grant and one proof unblock three callers and the
ADR-166 migration; the company-wide view appears automatically for every new
personal project; the trace repositories lose their hand-written tenants;
every visit is audited the same way admin workspace views are; no data is
duplicated; the hidden governance project stays untouched.

Negative: the ledger gains one row per (aggregate, member) pair, so an
organisation with two thousand personal projects and three aggregates holds
six thousand live rows; the reconciler is a new writer with its own failure
modes, mitigated by idempotent ids and a nightly sweep; the proof adds one
authz read per trace request, cached per org epoch; the blocks must be moved
once PR 7536 lands; online evaluations and annotations on member traces wait
for a later decision; the `aggregate` kind must be remembered by every future
"send traces here" surface.

Neutral: the governance area keeps configuration and dashboards; the project
switcher shows aggregates to admins alongside other projects; the Postgres
side keeps its existing guards until ADR-166's `prisma.as` lands.

## Open questions

- Department rule and history: should a project follow its owner's
  department on the day a trace was written rather than today? Owner:
  product, for v2.
- Online evaluations and annotations on member traces: where results live
  and who pays. Owner: product, fork for v2 via a revision here, reusing
  ADR-166's `findReaders`.
- REST `POST /api/projects` support for kind `aggregate`. Not in v1; owner:
  platform, when an API customer asks.
- Should the "project may read project" rule also cover the Developer seat's
  shared project immediately (ADR-143 point 5), or does that ship as its own
  pull request reusing this grant? Owner: the seat's author.
- Which trace routes outside `tracesV2` (REST, share links, exports) take
  the proof in v1 and which keep their hand-written tenant behind the lint
  baseline. Owner: this decision's author, settled in block F.

## Revisions

- v1 (2026-09-26): drafted after a speed-run of parc fermé. Locked by the
  captain: admins only; read only in v1; strictest policy plus audited
  reads; any project may be a member; no own ingest; one shared grant type
  for three callers; three rule shapes; ADR lives in the repo. Chosen by the
  author and open to overrule: materialised grants via a reconciler rather
  than read-time evaluation.
- v2 (2026-09-26): locked by the captain ("lets go"); status Accepted. Spec
  derived at `specs/governance/aggregate-project.feature`.
- v3 (2026-10-06): rebuilt on ADR-166 after the captain pointed at the
  grant-scoped data access design. Replaces the `tenantIds[]` reads with
  the sealed `Authorization` proof and the store client; adds
  `Grant.condition`; splits the work into seven blocks with a port plan
  into the feature layout. Status back to Proposed until the captain locks.
  Decided by the captain in this revision: the admin's rule attaches the
  grants, owners do not share by hand; build on `main` now and port into
  PR 7536 later; audit matches what exists (the five-minute admin view row
  with kind `aggregate`), the per-trace `trace.viewed` row is deferred with
  its slot kept.
- v4 (2026-10-06): locked by the captain ("lets go"); status Accepted. The
  two open forks of v3 were settled by the captain: build on `main` and port
  later; audit matches the existing admin view row. Implementation starts
  at block A.
- v4.1 (2026-10-06, implementation note, no decision changed): "writes no
  `TenantId`" in decision 6 means no tenant *predicate*. A repository may
  still project the column or name it in a dedup tuple
  (`(TenantId, TraceId, UpdatedAt) IN (...)`), since two member projects
  can hold the same trace id and the tuple is what keeps them apart. The
  client refuses a hand-written predicate; the lint gate checks for the
  same. The window on a shared grant is applied once, on the primary
  table's occurrence column; a subquery on a side table (evaluations,
  annotations) takes the tenant set without the window, because that
  table's timestamp is not the trace's.
- v4.2 (2026-10-06, implementation note after block C, no decision
  changed). Three limits the store client brings, recorded so block F and
  later readers do not rediscover them. A fold that reads a trace back
  under a project deleted since the event was written now fails with
  `AccessNotGrantedError` and takes the pipeline's retry path, where the
  base wrote an orphan row; the failure is the intended outcome, and the
  lineage lookup behind it is cached for sixty seconds per project. On an
  aggregate, which member wins a trace id held by two members is
  deterministic per read path, not per trace: the hint-less summary read
  takes the earliest occurrence and a hinted read takes the one nearest
  its hint; block F threads the tenant from the summary read through the
  reads that follow it so the detail page stays on one member. Log records
  and the analytics rollup table keep their hand-written tenant until a
  fifth time column (`TimeUnixMs`) is admitted to the client's list, which
  is a decision for block F.
- v4.3 (2026-10-06, implementation note after block D, no decision
  changed). Choices the text left open, settled in code and recorded here.
  "Organisation admin" means `OrganizationUser.role` of `ADMIN`; creating
  an aggregate asks for `organization:manage` and that role. A non-admin
  gets the ordinary denial, no new reason code names the kind. The admin
  gate lives in the app's permission decision path, not in the authz
  server, and reads the kind once per process; the same gate now covers
  the batch permission paths, the credential batch, the effective
  permission set and the LangWatchQL readable-project cut, where "admin"
  for a key is the key owner's role and an ownerless service key is never
  admitted. No key bound to an aggregate acts for any permission, an
  admin's included; whether admin-owned keys may read an aggregate over
  REST once block F lands stays open and defaults to no. The kind rules
  live in `projects/project-kinds.ts` so permission adapters import no
  service. An explicit rule naming any foreign, archived, missing,
  governance or aggregate project id is refused whole; `membersOf` drops
  ids no longer readable; an aggregate is never its own member nor a
  member of another aggregate; a department rule must name a live
  department. Creation mints no Langy virtual key. The navigation hides
  Home as well as Test, Build and Online Evals; server-side refusal covers
  monitor creation and copy, while refusing every write under the
  aggregate's tenant (experiments, simulations, playground) is a block G
  item. REST edit and archive of an aggregate answer not found unless the
  key owner is an admin. The aggregate's `apiKey` and `lwqlKey` are
  blanked on every team and organisation listing. Nothing reads
  `aggregateRule` back yet; block E adds a parsing read in the repository,
  on the pattern of `grantConditionFromDb`. The default landing project
  can still be an aggregate for an admin, left to block F.
