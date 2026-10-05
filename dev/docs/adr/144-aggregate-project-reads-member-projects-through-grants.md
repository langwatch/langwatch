# ADR-144: An aggregate project reads its member projects through project-reader grants

**Date:** 2026-09-26

**Status:** Proposed

**Builds on:** ADR-092 (the grants ledger and the resolver walk), ADR-110 (a
grant is an aggregate), ADR-143 (the Developer seat, point 5: traces appear
in a shared project once "project may read project" lands), ADR-142 (the
query API already reads several projects under one key).

**Related:** ADR-018 (governance as one observability substrate), ADR-038
(governance and LLM ops are two intents on one platform), ADR-057 (share
links are the only beyond-audience exposure today), tasks#904 (cross-project
query in the product), tasks#867 (two-project organisation key e2e).

> One-line: a **governance project** is a normal project of kind
> **`aggregate`** that owns no traces and whose trace list, trace detail and
> analytics read every **member project** named by a stored **scope rule**,
> which a reconciler materialises into one **`project-reader` grant** per
> member in the grants ledger; only **organisation admins** may open it, every
> read is **audit-logged**, and the **strictest member privacy policy** applies.

## Context

Leadership wants a company-wide view of traces, starting with the personal
projects that coding agents write into. The hidden per-organisation
governance project (`Project.kind = "internal_governance"`) already captures
ingestion-source data, but it is unroutable by design, excluded by fifteen
filters, and was never meant to be opened as a project. The governance area
keeps configuration and dashboards; traces stay organised per project.

Picking member projects one by one does not scale: every new sign-up creates
a personal project that would need adding by hand. So the view needs a rule,
not a list, and the rule must keep applying as projects appear and people
move between departments.

Nothing on `main` lets one project read another. The grants ledger refuses a
`project` principal on any project but its own
(`platform/app/src/server/event-sourcing/pipelines/authz-grants/schemas/events.ts`,
`grantShapeRefinement`). Every trace read hard-codes one tenant
(`trace-list.clickhouse.repository.ts`, `trace-summary.clickhouse.repository.ts`,
`span-storage.clickhouse.repository.ts`). The resource-tier matcher anchors
on `grant.projectId === scope.projectId` (`packages/authz/src/matchers.ts`).
ADR-143 point 5 and tasks#904 both wait on the same missing rule, which is why
this decision builds it once rather than three times.

Two precedents already read several projects in one query and are reused
here: the coding-agent session repository (`WHERE TenantId IN
{tenantIds:Array(String)}`, routed per organisation so every member of one
organisation resolves to one ClickHouse endpoint) and the LangWatchQL service,
which accepts a list of project callers and bills only when there is one.

Constraints confirmed for this decision:

- Data is stored once, in the project that received it. The aggregate never
  copies or re-ingests a trace.
- The aggregate is a real project with its own id, created from the LLM ops
  "new project" flow, not from governance settings.
- Reuse the grants ledger. No parallel access table.
- The hidden `internal_governance` project is untouched and is never a
  member.

## Decision

1. **A new project kind, `aggregate`.** `Project.kind` is already a free-form
   string, so no migration is needed for the kind itself. An aggregate project
   is created through the existing `project.create` tRPC path with
   `kind: "aggregate"` and a scope rule. It attaches to a team like any
   project. We reject a separate `AggregateProject` table because the
   project id is what every trace route, nav item and permission check
   already keys on; a new table would need its own routing, guards and
   pickers.

2. **The scope rule is stored on the project, as data.** A new nullable
   column `Project.aggregateRule` (JSON) holds one of three shapes:
   `{ kind: "all-personal" }`, `{ kind: "personal-by-department",
   departmentId }`, or `{ kind: "explicit", projectIds: [...] }`. The default
   on creation is `all-personal`. Any project in the organisation may be
   named by an explicit rule, including other people's personal projects,
   because only organisation admins can open the aggregate (choice 5).
   Department membership is read from the owner's current
   `OrganizationUser.departmentId`; history is ignored in v1.

3. **One `project-reader` grant per member, materialised by a reconciler.**
   The rule is not evaluated at read time. A reconciler resolves the rule to
   the current member set and emits `grant attached` and `grant revoked`
   events so the ledger holds exactly one live row per (aggregate, member)
   pair: principal `PROJECT` = the aggregate, scope `PROJECT` = the member,
   `roleKey = "project-reader"`, `source = "aggregate-reconciler"`. Grant ids
   are deterministic KSUIDs derived from the pair, so a replay or a repeated
   run is idempotent. The reconciler runs on four triggers: rule created or
   edited, personal workspace created or reactivated, department assigned,
   and a nightly sweep per organisation that catches anything the triggers
   missed. We choose materialisation over read-time evaluation because the
   grant row is the thing ADR-143 and tasks#904 reuse; a read-time rule
   would give those callers nothing, and a cached rule would make "who can
   see this trace" depend on cache age.

4. **The grant shape refusal is lifted for this one shape only.**
   `grantShapeRefinement` gains one legal placement for a `project`
   principal on a foreign project: `roleKey === "project-reader"` and both
   projects in the same organisation. Every other foreign placement, every
   team or organisation placement and every other role key stay refused.
   `project-reader` is a built-in role whose whole permission list is
   `traces:view` and `analytics:view`. It never carries `*:manage`, and it
   never applies to a user or API-key principal.

5. **Only organisation admins may open an aggregate project.** The project
   route guard (`project.service.ts` route guard, `routers/project.ts`)
   refuses any caller who is not an organisation admin when the target kind
   is `aggregate`, regardless of team membership. The Developer seat and
   every non-admin member see nothing. We reject "anyone on its team"
   because it turns a team add into a silent read grant over other people's
   personal data, and we reject "only what the viewer could read anyway"
   because it cannot deliver a company-wide view.

6. **Reads resolve the member set from live grants and query all tenants at
   once.** A `memberProjectIds({ aggregateProjectId })` read returns the
   scope ids of live `project-reader` grants whose principal is the
   aggregate. The trace list, trace detail header, span reads and analytics
   accept a list of tenant ids and query `TenantId IN {tenantIds}` on the
   organisation's single ClickHouse endpoint, following the coding-agent
   session repository. A trace from a project outside the live set
   contributes nothing. Member traces are first-class rows in the list: they
   link to their own detail page under the aggregate's slug, carrying the
   owning project id so the detail read knows which tenant to open.

7. **The aggregate owns no traces and no credential.** `Project.apiKey`
   stays populated because the column is required, but the ingest routes,
   the virtual-key destination resolver, the CLI project picker and the
   ingest-key mint all refuse or hide kind `aggregate`. The key is never
   displayed. Billing counts stay with the owning project; the aggregate's
   trace count is always zero.

8. **Read only in v1: no online evaluations run from the aggregate.** The
   list and detail show the owner's existing evaluation results. No monitor
   can be created on an aggregate, and the evaluation trigger subscriber is
   untouched. Online Evals, Test and Build are hidden from the aggregate's
   navigation; Observe shows Analytics and Traces. Annotations on member
   traces are out of scope.

9. **Strictest member privacy policy, every read audited.** The effective
   privacy policy of an aggregate read is the most restrictive among its
   current members, matching the query API precedent. Every list or detail
   read records an `AdminWorkspaceViewAuditService` row with a new kind
   `aggregate`, target = the aggregate project id, deduplicated by the
   existing five-minute window.

10. **Shared primitive, first caller.** The grant row, the role key, the
    refinement change, the `memberProjectIds` read and the multi-tenant
    repository methods are shared. The `aggregate` kind, the rule column,
    the reconciler triggers and the create-flow UI belong to this caller.
    ADR-143 (shared project reads a personal project) and tasks#904
    (cross-project charts) attach their own grants with the same role key
    and reuse the reads. We target the shared part covering roughly 80% of
    what those callers need and leave rule authoring to each.

## Constants

| Name | Value | Purpose |
|---|---|---|
| `PROJECT_KIND_AGGREGATE` | `"aggregate"` | `Project.kind` value |
| `PROJECT_READER_ROLE_KEY` | `"project-reader"` | `Grant.roleKey` for a project-to-project read grant |
| `PROJECT_READER_PERMISSIONS` | `["traces:view", "analytics:view"]` | the role's whole permission list |
| `GRANT_SOURCE_AGGREGATE_RECONCILER` | `"aggregate-reconciler"` | added to `GRANT_EVENT_SOURCES` |
| `AGGREGATE_RULE_KINDS` | `"all-personal" \| "personal-by-department" \| "explicit"` | discriminator of `Project.aggregateRule` |
| `AGGREGATE_DEFAULT_RULE` | `{ kind: "all-personal" }` | preselected on creation |
| `ADMIN_WORKSPACE_VIEW_DEDUP_MS` | `300000` (5 × 60 × 1000) | existing audit dedup window, reused |
| `AGGREGATE_RECONCILE_SWEEP` | nightly, per organisation | catch-up for missed triggers |

## Invariants

| Invariant | Meaning | Test anchor |
|---|---|---|
| Foreign placement stays refused | Only `project-reader` on a same-organisation project lifts the refusal | `authz-grants/schemas/events.test.ts`: every other foreign placement, team placement, organisation placement and role key is refused |
| Read grants never escalate | `project-reader` satisfies only `traces:view` and `analytics:view` | `packages/authz` matcher test: `traces:manage`, `project:manage`, `prompts:view` all denied through a `project-reader` grant |
| No leak outside the live set | A tenant id not in the live grant set returns zero rows from every multi-tenant read | integration test per repository: list, summary, spans, analytics with a foreign id in the input list |
| Same organisation only | A member project in another organisation is never attached | reconciler test: cross-organisation candidate dropped; refinement test: cross-organisation pair refused |
| Hidden governance project never a member | `internal_governance` is excluded by every rule kind | reconciler test |
| Admins only | A non-admin, including a Developer seat, is refused at the route guard and the tRPC guard | `projectFilter.invariant.integration.test.ts` extension plus guard unit test |
| Reconciler is idempotent | Two runs, or a replay, produce the same grant ids and no duplicate rows | reconciler test comparing ledger state after two runs |
| Rule changes converge | Removing a project from an explicit rule revokes its grant; a new personal project under `all-personal` is attached on creation | reconciler trigger tests |
| Data stored once | The aggregate's own tenant id holds zero spans; billing counts unchanged | ingest route test returns 403 for kind `aggregate`; `trace-usage.service` test unchanged |
| Every read audited | A list or detail read by an admin writes one audit row per five-minute window | `adminWorkspaceViewAudit.service` test with kind `aggregate` |
| Strictest policy wins | With members at policies A (loose) and B (strict), the aggregate read applies B | privacy policy read test |

## Assumptions

| Assumption | What breaks if false |
|---|---|
| Every member of one aggregate lives in the same organisation, so ClickHouse routing resolves to one endpoint | Reads would need cross-endpoint fan-out and merge; the same-organisation refinement makes this a hard rule, not a hope |
| `Project.kind` is only ever read for the `internal_governance` filter today | A reader that assumes "not internal_governance means application" would treat an aggregate as a normal project; the sweep in Phase 5 lists every `kind` read |
| Personal project owners carry their department on `OrganizationUser.departmentId` and nowhere else | A department set on `Team` or `Project` but not on the user would be ignored by the by-department rule |
| Grant ids are deterministic KSUIDs derived from event content (schema comment on `Grant`) | Reconciler idempotency would depend on a lookup before each emit |
| The audit service's five-minute dedup is acceptable for compliance when the target is an aggregate rather than one person | Compliance may require one row per member project read; recorded as an open question |

## Gates

| Path | Reversible? | Blast radius | Required gate |
|---|---|---|---|
| Lift the foreign-project refusal in `grantShapeRefinement` | No: grants are ledger facts | Large: security boundary | Human review on the PR plus the "foreign placement stays refused" unit test; the PR does not merge without both |
| Multi-tenant reads in trace list, summary, spans, analytics | Yes | Large: tenant leak | Automated: the "no leak outside the live set" integration test per repository, and the existing apidiff negative tests stay green |
| `Project.aggregateRule` column migration | Yes | Small | Migration ships with a tested down path (drop column) |
| `project-reader` built-in role | Yes | Large: permission surface | Automated: matcher test proving the permission list is closed |
| Route and tRPC guard for admins only | Yes | Large: personal data exposure | Automated: guard tests for admin, member, Developer seat, external |
| Reconciler emitting ledger events | Partly: revocation marks rows | Medium | Automated: idempotency and convergence tests; nightly sweep as detection |
| Ingest refusal for kind `aggregate` | Yes | Small | Automated: route test |
| Audit row on every read | Yes | Medium: compliance evidence | Automated: service test |
| Navigation hiding Test, Build, Online Evals | Yes | Small | None; detection by the UI contract spec |

## Schema

```prisma
model Project {
  // ...
  /// Project kind gains:
  ///   - "aggregate": a project that owns no traces and reads its member
  ///     projects through project-reader grants (ADR-144). Hidden from every
  ///     "send traces here" picker and from ingestion; visible in the
  ///     project switcher to organisation admins only.
  kind          String @default("application")
  /// ADR-144: the scope rule an aggregate project materialises into grants.
  /// Null on every other kind. Shapes: { kind: "all-personal" } |
  /// { kind: "personal-by-department", departmentId } |
  /// { kind: "explicit", projectIds: string[] }.
  aggregateRule Json?
}
```

Migration: `ALTER TABLE "Project" ADD COLUMN "aggregateRule" JSONB;` with
down path `ALTER TABLE "Project" DROP COLUMN "aggregateRule";`. No change to
`Grant`: the new row shape uses existing columns (`principalType = PROJECT`,
`scopeType = PROJECT`, `roleKey = "project-reader"`, `source =
"aggregate-reconciler"`).

## Rejected alternatives

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
- **Run the aggregate's online evaluations on member traces in v1.** Doubles
  evaluation cost per trace and needs a new pipeline fan-out; deferred.
- **Per-row privacy policy.** Correct per trace but mixes redaction levels in
  one list and slows the query; strictest-wins matches the query API.
- **Aggregate with its own API key and traces.** Muddies "data stored once"
  and forces the aggregate into every key picker and billing path.
- **Aggregate-only grant shape.** Faster now, second authz path later.

## Consequences

Positive: one grant primitive unblocks three callers; the company-wide view
appears automatically for every new personal project; every read is audited;
no data is duplicated; the hidden governance project stays untouched.

Negative: the ledger gains one row per (aggregate, member) pair, so an
organisation with two thousand personal projects and three aggregates holds
six thousand live rows; the reconciler is a new writer with its own failure
modes, mitigated by idempotent ids and a nightly sweep; online evaluations
and annotations on member traces wait for a later decision; the `aggregate`
kind must be remembered by every future "send traces here" surface.

Neutral: the governance area keeps configuration and dashboards; the project
switcher shows aggregates to admins alongside other projects; a possible
rename of "project" to "workspace" is unaffected.

## Open questions

- Compliance may need one audit row per member project read, not one per
  aggregate. Owner: the governance lead, before the compliance baseline spec
  is amended.
- Department rule and history: should a project follow its owner's
  department on the day a trace was written (`departmentsOnDay`) rather than
  today? Owner: product, for v2.
- Online evaluations and annotations on member traces: where results live
  and who pays. Owner: product, fork for v2 via a revision here.
- REST `POST /api/projects` support for kind `aggregate`. Not in v1; owner:
  platform, when an API customer asks.
- Should the "project may read project" rule also cover the Developer seat's
  shared project immediately (ADR-143 point 5), or does that ship as its own
  pull request reusing this grant? Owner: the seat's author.

## Revisions

- v1 (2026-09-26): drafted after a speed-run of parc fermé. Locked by the
  captain: admins only; read only in v1; strictest policy plus audited
  reads; any project may be a member; no own ingest; one shared grant type
  for three callers; three rule shapes; ADR lives in the repo. Chosen by the
  author and open to overrule: materialised grants via a reconciler rather
  than read-time evaluation.
