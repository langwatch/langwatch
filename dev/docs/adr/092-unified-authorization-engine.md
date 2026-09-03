# ADR-092: Unified authorization engine - one registry, one resolver, every principal

**Date:** 2026-07-16

**Status:** Proposed (supersedes ADR-001 when accepted)

**Partially superseded:** §13's aggregate choice — one aggregate per
organization, `aggregateId = organizationId` — is replaced by
[ADR-110](110-grant-aggregates-are-grants.md), which makes a grant and a role
each their own aggregate. The organization is the tenant of every event and the
aggregate of nothing; there is no cutover flag (ADR-110 deletes it and the
`AuthzCutoverProjection` table), and rollout state moves off the authorization
aggregates entirely onto `SystemMigrationTenantState`. The widening cohort
this ADR plans is also finished: the migration now declares itself enrolled
automatically, so every cloud organization is in its cohort with no operator
action, and an organization created since is adopted by the next pass rather
than waiting to be enrolled. Everything else here stands.

The package names and implementation placement in this ADR are also
superseded by the
[AuthZ feature boundary](../../../packages/features/authz/adrs/001-package-boundary.md).
The portable contract is now `@langwatch/authz-contract`; concrete services,
Prisma-compatible repositories, Redis and Eventing adapters, projections and
the domain migration live in `@langwatch/authz-server`; the application
runtime root and process-role-aware preset retain composition and transport
ownership. Authorization semantics in this ADR are unchanged.

## Decision, in one paragraph

We will collapse LangWatch authorization into one feature: the browser-safe
`@langwatch/authz-contract` vocabulary and pure `AuthzEngine`, concrete
services and private infrastructure in `@langwatch/authz-server`, and a thin
application runtime or transport adapter. Built from three nouns -
**permission** (a verb on a
resource), **role** (a named set of permissions), **role binding** (who holds
which role, where) -
resolved by **one engine** that every surface (tRPC, Hono, services, workers,
frontend) and every principal (user, API key, share token, demo visitor,
platform ops, with group membership expanded into user grants) goes through.
The permission vocabulary becomes a typed registry that knows what each
resource can do. Grant semantics become an explicit additive union. The legacy
`TeamUser`/`OrganizationUser` role paths get backfilled into role bindings and
deleted, and every decision emits one auditable record. Part II (§6-§12)
covers operating it: one Access surface with "why?" built in, fail-closed
enforcement down to the type level, a resource tier where sharing a trace is
a grant row that covers the trace's children and can name any audience (a
user, a team, an org, anyone), owner-implicit grants on user-created
resources, offboarding as one proven verb, the setting/checking API itself,
and epoch-validated checks that skip the database on the hot path.

## The three nouns (the whole mental model)

```
 PERMISSION    a verb on a resource                      "prompts:update"
               (the registry says which verbs each        "traces:share"
                resource supports - nothing else exists)  "organization:manage"

 ROLE          a named set of permissions                 admin / member / viewer /
               (built-ins defined in code; custom         lite-member / your own
                roles are rows holding the same shape)    "SRE on-call" custom role

 ROLE BINDING  WHO holds WHICH ROLE, WHERE - one row, three columns:

               ┌─ WHO (principal) ─┐   ┌─ WHICH ROLE ──┐   ┌─ WHERE (scope) ────┐
               │ user  alice       │   │ member         │   │ org     acme       │
               │ group sec-eng     │ + │ viewer         │ + │ team    client-a   │
               │ api key lw-sk-42  │   │ custom "SRE"   │   │ project chatbot    │
               └───────────────────┘   └────────────────┘   └────────────────────┘
```

Bindings sit on the scope tree, and grants flow **down** it. No binding on
your path up the tree means no access. There is no default access anywhere:

```
 Organization acme ◄──── alice = admin @ org        (sees/manages everything below)
 │
 ├── Team client-a ◄──── group "contractors" = viewer @ team  (read-only, both projects)
 │    ├── Project chatbot ◄──── api key lw-sk-42 = member @ project
 │    └── Project emailbot
 │
 └── Team client-b       (contractors and the api key have NOTHING here -
                          no binding on this branch, no access)
```

An **API key is a principal you can put in a script**. Same binding table,
same roles, same scopes, plus a leash to its owner:

```
 ┌──────────────────────────────────────────┐
 │ ApiKey lw-sk-42                          │
 │   owner: dave        (none ⇒ service key)│
 │   bindings: member @ project chatbot     │
 └──────────────────────────────────────────┘

 effective(key) = grants(key) ∩ grants(owner)         ← intersection, live:

     grants(key)           grants(dave, today)
   ┌───────────────┐     ┌───────────────┐
   │ traces:view    │     │ traces:view   │     key can do: traces:view and
   │ traces:create  │  ∩  │ (dave demoted │  =  nothing else - demoting dave
   │ datasets:*     │     │  to viewer)   │     demoted his keys instantly,
   └───────────────┘     └───────────────┘     no rotation ceremony needed
```

And every access question is one walk:

```
 can(alice, "prompts:update", project:chatbot)?

 1  COLLECT   bindings WHERE who ∈ {alice} ∪ alice's groups
 2  FILTER    where ∈ {project:chatbot, team:client-a, org:acme}   ← walk UP the tree
 3  EXPAND    each binding's role → its permission set             ← registry lookup
 4  UNION     all the sets (grants only ever ADD, see §3)
 5  DECIDE    "prompts:update" ∈ union ?
 6  RECORD    → AuthzDecision { principal, permission, scope,
                                outcome, matchedBinding | denialReason }
```

Attach, update, revoke, and "reduce someone's access" are all row operations
on bindings. Visible, auditable, effective on the next check:

```
 ATTACH   INSERT (alice, viewer, chatbot)          → next check sees it
 UPDATE   UPDATE that row's role viewer → member   → next check sees it
 REVOKE   DELETE the row                           → access gone on next check
 REDUCE   there is no "override down" - you replace a broad grant
          with a narrower one:
            before:  alice = member @ org acme     (every team, every project)
            after:   DELETE that row
                     INSERT alice = member @ team client-a
          why: grants only add (§3), so LESS access = SMALLER grant,
          never a second binding fighting the first
```

## Context

### What we have today

This is the part of the ADR where the receipts live - skip to the Decision if
you already believe us. The current system is ADR-001's RBAC after years of
accretion, plus a strangler migration to scoped role bindings that stopped
halfway. Both generations are live and load-bearing. The same question -
_"can alice update this prompt?"_ - is answered by different code depending
on which door the request came through:

```
                        "can alice update this prompt?"
                                      │
    ┌──────────────┬─────────────────┼──────────────────┬────────────────────┐
    ▼              ▼                 ▼                   ▼                    ▼
 tRPC guards   Hono SecuredApp   ~15 hand-rolled     4 per-domain        the CLIENT
 302 project   ≈150 routes      in-handler auth     *.authz.ts files    (5th resolver:
 + 76 org      requires(perm)   blocks (routes/     (gateway, model-    the browser
 + 5 team      + 26 apiKey-     collector, otel,    providers, data-    re-derives
 attach sites  Permission(...)  playground, sse,    privacy, data-      decisions from
    │              │            langy, exports…)    retention)          bundled bags)
    │              │                 │                   │                    │
    ▼              ▼                 ▼                   ▼                    ▼
 rbac.ts  ─────────────────────► role-binding-resolver.ts ◄── api-key ceiling path
 checkPermissionFromBindings()   checkRoleBindingPermission()
 + batchScopePermissions()       (parallel impl, "must stay
 (2 parallel impls in 1 file)     in sync" by comment)
    │                                 │
    ├── legacy TeamUser fallback ─────┤
    ▼                                 ▼
 Postgres: OrganizationUser · TeamUser · RoleBinding · CustomRole · Group
           (two generations of truth, dual-written, drift possible)
```

Concretely, all verified in-tree, July 2026:

1. **Five resolver implementations, kept in step by hand.**
   `checkPermissionFromBindings` (`server/api/rbac.ts:728`), the batch copy
   `evaluateBinding` (`rbac.ts:1204`), the API-key/gateway copy
   `checkRoleBindingPermission` (`server/rbac/role-binding-resolver.ts:180`),
   the audit-page list variant
   (`server/role-bindings/role-binding.service.ts:255`), and the
   **client-side** copy in `useOrganizationTeamProject.hasPermission`
   (`hooks/useOrganizationTeamProject.ts:397`), which re-derives decisions
   from the server's role bags bundled into the browser. Two of them carry a
   literal _"must stay in sync with…"_ comment (`rbac.ts:832`,
   `role-binding-resolver.ts:239`). They have already diverged: the tRPC
   resolver caps org-scoped bindings for EXTERNAL users (`rbac.ts:807`), the
   API-key resolver applies no such cap
   (`role-binding-resolver.ts:249-257`). The server even patches the
   client's copy from the outside - `organization.getAll` promotes
   binding-only admins into the exposed member-row role so the client hook
   stays honest (`routers/organization.ts:233-245`).

2. **The spec and the code disagree on the core semantic.**
   `specs/rbac/scoped-role-bindings.feature` specifies
   _most-specific-scope-wins_ ("Project-level binding **overrides**
   team-level binding": org Admin + project Viewer means effective Viewer).
   Every implementation does an **additive union** ("permitted if ANY binding
   grants"). `role-binding-resolver.ts` disagrees with itself, even - the
   `ancestorScopes` comment says "picks the first matching binding" while the
   function unions. Nobody noticed. That rather answers which semantic has
   real users.

3. **The vocabulary has no resource knowledge, and every projection of it is
   hand-maintained.** `Permission` is the raw cross product
   `${Resource}:${Action}` (`rbac.ts:113`), so `traces:rotate` and
   `cost:attach` typecheck, and the custom-role validator
   (`server/rbac/custom-role-permissions.ts:6`) accepts them into the
   database. Which actions a resource _actually_ supports lives in four
   disconnected places: the role bags (`rbac.ts:168-437`, roughly 200
   hand-ordered lines where ADMIN and MEMBER are near-duplicate lists
   maintained by eye), a roles-UI if-chain (`utils/permissionsConfig.ts:40`)
   that omits every gateway resource, API-key read/write bundles
   (`server/api-key/permission-categories.ts`, where "write" on `project`
   quietly includes `project:delete`), and the permission-picker's own
   client-side hierarchy rules (`PermissionSelector.tsx:60-110`) which differ
   from the server's (`rbac.ts:484-492`). The drift is measurable. A custom
   role can _store_ `virtualKeys:manage` but the UI can neither author nor
   display it (`PermissionViewer` silently hides grants outside its
   catalogue). An **empty** custom role locks the entire UI while the server
   falls through to a viewer-level bag
   (`useOrganizationTeamProject.ts:422-432` vs `rbac.ts:842-861`). A census
   across the app puts it at **sixteen** distinct permission/role/credential
   vocabularies and encodings in play - role bags, category tables,
   `ApiKey.permissionMode` strings, custom-role kinds, the `custom:${id}` UI
   encoding, eight credential prefix families, six internal-secret schemes.

4. **Two generations of assignment, half-migrated.** New memberships
   dual-write `OrganizationUser` plus an ORGANIZATION-scoped `RoleBinding`
   (`server/better-auth/hooks.ts:137-152`). Old users still resolve through
   `TeamUser` fallbacks inside every resolver. `OrganizationUser.role` is
   authoritative for EXTERNAL restrictions but explicitly _not_ for ADMIN
   power (`rbac.ts:1050-1057`) - the same column means different things
   depending on its value. Meanwhile six `where: { role: "ADMIN" }` queries
   (usage-limit notifications, langy attribution, `resolveOrgAdminEmail`,
   more) read only `OrganizationUser`, so **binding-only admins are invisible
   to them**. The UI says admin, the notification fan-out finds nobody
   (issue #3429's bug class).

5. **One enum, scope-dependent meaning.** `RoleBinding.role` reuses
   `TeamUserRole`. At team scope ADMIN means the team bag. At org scope ADMIN
   means _everything_ and MEMBER means _the org bag only_ - special-cased at
   `rbac.ts:797-814` and again at `role-binding-resolver.ts:249-257`. A
   role's meaning should come from the role, not from where the binding
   sits.

6. **Special principals are bolt-ons, and one of them bypasses everything.**
   Public shares are a wrapper middleware that invokes the real check with a
   fake `next` and catches UNAUTHORIZED (`rbac.ts:1473`). The demo project is
   an env-compare inside the resolver (`rbac.ts:1354`). Platform ops is an
   `ADMIN_EMAILS` env list (`ee/admin/isAdmin.ts`) - `ops:view`/`ops:manage`
   exist in the vocabulary but **no role can hold them**, and
   `resolveOpsScope` ignores the `permission`, `userId`, and `prisma`
   arguments it takes (`rbac.ts:1557`). EXTERNAL "lite member" - which the
   code itself calls "a billing classification, not an access-control
   boundary" (`rbac.ts:1018`) - is special-cased in at least four resolver
   places plus a parallel client axis (`useLiteMemberGuard`, 21 consumers),
   and issue #3388 is a live licensing bug born from the conflation. Worst
   of all: **legacy project API keys skip RBAC entirely, by design** -
   `enforceApiKeyCeiling` returns early for them ("project API keys bypass
   RBAC", `server/api-key/auth-middleware.ts:334-343`), making every
   carefully declared `requires(permission)` on the REST surface
   view-through for the oldest, most widely deployed credential type we
   have.

7. **Escape hatches and copy-paste are load-bearing.** 23 tRPC
   `skipPermissionCheck` sites (its sensitive-key guard is shallow - plural
   keys like `organizationIds` sail through, admitted at
   `featureFlag.ts:111`), 16 `authorizeInResolver` sites (the check happens
   "somewhere in the service"), ~25 imperative `hasProjectPermission`
   second-phase calls inside procedure bodies, and **~15 hand-rolled
   in-handler auth blocks** behind `handlerManagedAuth`. The same
   TokenResolver-plus-ceiling 30-liner is pasted across
   `routes/collector.ts`, `otel.ts`, `annotations.ts`, `traces-legacy.ts`,
   `experiments-v3.ts` and friends, and the same session-plus-permission
   15-liner across `playground.ts`, `sse.ts`, `langy.ts`,
   `export/traces/app.ts`.

8. **The consolidation points themselves drift.** The four per-domain
   `*.authz.ts` modules declare four identical local `RBACContext` types,
   advertise framework independence, and throw `TRPCError` anyway (breaking
   any worker or Hono caller). Project-tier write means `project:manage` in
   `modelProvider.authz.ts` but `project:update` in privacy/retention - a
   divergence the retention file documents as a past production bug
   (`dataRetentionPolicy.authz.ts:34-40`). `checkOrganizationPermission`
   diverges from its project/team siblings (no `ctx.organizationRole`, no
   lite-member branch, a non-null `Session` requirement the others don't
   have). And a **third route-security convention** is already staged: the
   versioned Hono builder in `packages/api` (PR #3156) ships per-endpoint
   `auth: "none"` - a skip-friendly design not yet reconciled with
   SecuredApp's mandatory-policy model.

9. **The client answers "may I?" nine different ways.** Permission-string
   checks (HOC / inline / disabled / early-return), raw role comparisons
   (129 `role ===` sites across 31 files - `DashboardLayout.tsx` alone has
   three separate org-role gates), `isLiteMember` booleans,
   `api.user.isAdmin` email-allowlist queries, ops-scope probes, and
   endpoint-shape probes (`isAdmin = orgMembers.length > 0`,
   `ApiKeysSection.tsx:126`). `AddMembersForm.tsx` re-implements
   `memberRoleConstraints.ts` wholesale.

10. **The knock-ons are already live.** Because the API-key resolver ignores
    lite-member status (`role-binding-resolver.ts:249-257`) while SCIM
    unconditionally provisions an ORG-scoped MEMBER binding it never
    downgrades (`scim.service.ts:153-204`), a lite member's personal API key
    can out-privilege their own session. Service keys with zero bindings
    default to org-wide ADMIN (`api-key.service.ts:151-161`). The
    optimization-studio → nlpgo hop carries no auth at all ("There is no
    auth on this hop", `nlpgoFetch.ts:115`) and the control plane injects
    the legacy project key - the RBAC-bypassing credential from #6 - into
    every workflow payload (`WorkflowService.prepareStudioEvent`), so studio and evaluation
    runs act as an unrestricted full-project principal. Background workers
    run with no principal at all (raw Prisma/ClickHouse, tenant isolation
    only via ids in job payloads). And the same action needs different
    permissions per door: creating an annotation is `annotations:create` on
    tRPC (`routers/annotation.ts:124`, deliberately held by lite members)
    but `annotations:manage` on REST (`routes/annotations.ts:262`), while
    the model-defaults REST app authorises against the key OWNER's
    permissions and never consults the key's own restricted bindings
    (`model-defaults/app.v1.ts:115-240`).

The cost is measurable. `rbac.ts` (1,612 lines) has absorbed **28 commits
since January** - every feature family (governance, gateway, ops, API keys,
model providers, sharing) has had to modify the core authz file to ship. PR
#4283's audit of the Hono surface found **26 routes with no authorization
gate, 31 with a wrong or too-weak permission, 2 cross-tenant exposures, and
189 routes without a permission regression test**. Those gaps exist _because_
enforcement is per-surface. Issues #1247 (consolidate the permission
modules), #4008 (type-level permission enforcement for Hono), #3685
(governance granularisation), #3429 and #3388 all ask for pieces of the same
fix. ADR-001 itself now cites a helper (`checkPermissionOrThrow`) and a file
(`permission.ts`) that no longer exist.

### The bones worth keeping

This ADR is a consolidation, not a rewrite of the data model. Five things in
today's design are genuinely good and survive intact:

- the `resource:action` vocabulary and the tuple _model_ behind `RoleBinding`
  - it _is_ a Zanzibar-style tuple store, groups and API keys included. (The
    model survives; the storage is reborn as the event-sourced `Grant` table in
    §13, with `RoleBinding` continuing as a derived compat view until contract);
- the tRPC builder that makes a permission middleware impossible to skip
  (`permissionProcedureBuilder` exposes only `.input`/`.use`, then splices in
  `enforcePermissionCheck` - `trpc.ts:721,238`);
- the Hono `SecuredApp`/`AccessPolicy` design with mandatory reason strings
  and the no-allowlist route-registry integration test
  (`security/__tests__/api-endpoint-authorization.integration.test.ts`);
- the no-stale-grants property: the session deliberately carries no roles, so
  a revoked binding takes effect immediately. §12 keeps this property while
  removing the per-check database cost - epoch-validated caching, not
  long-lived permission blobs;
- restricted API keys already persist their permission set as a `CustomRole`
  row (`kind: "system_api_key"`) bound through the same `RoleBinding` table.
  The tuple model working for a non-user principal, in production, today.

## Decision

### 1. One registry, with resource knowledge

A single `as const` registry declares every resource, the actions it supports, the scopes it can be granted at, what `manage` implies for
it, and its presentation metadata. Everything else is **derived** from it:

```
 packages/features/authz/contract/src/registry.ts
 ┌─────────────────────────────────────────────────────────────────┐
 │ traces:       actions: view · share · create · update           │
 │               scopes:  project · team · org                     │
 │ cost:         actions: view              (read-only resource)   │
 │ governance:   actions: view · manage     scopes: org ONLY       │
 │ virtualKeys:  actions: view · create · update · delete · rotate │
 │               · manage · viewOtherPersonal                      │
 │ ops:          actions: view · manage     scopes: platform       │
 │ …                                                               │
 └─────────────────────────────────────────────────────────────────┘
        │ derives
        ├── type Permission        = only VALID pairs (traces:rotate = type error)
        ├── zod validator          = same pairs (custom roles can't store nonsense)
        ├── roles-UI action lists  (replaces utils/permissionsConfig.ts if-chain
        │                           AND PermissionSelector's private hierarchy)
        ├── API-key read/write     (replaces api-key/permission-categories.ts)
        ├── manage-implication     (replaces the endsWith/replace string surgery)
        └── docs + review matrix   (pnpm authz:matrix → diffable markdown table)
```

`ORG_EXCLUSIVE_RESOURCES` becomes the registry's `scopes:` field - the
ADR-021 rule ("a team/project binding can never grant an org-exclusive
permission") stops being a special case and becomes data the engine reads. A
`platform` scope makes `ops:*` grantable by exactly one source (§4) instead
of being vocabulary no role can hold.

Built-in roles are declared in the same module _as differences, not
duplicates_:

```
 viewer      = every registry resource's `view` (where scope fits)
 member      = viewer + declared additions   (create/update on work resources…)
 admin       = member + declared additions   (deletes, team:manage, budgets…)
 lite-member = viewer + annotations create/update   (its OWN role, see §4)
```

Adding a resource becomes one registry entry plus marking which built-in tier
gains it. Not editing four 80-line arrays and three UI catalogues in step,
and hoping.

### 2. One resolver, one decision shape

The six-step walk pictured above is implemented **once**, in
`packages/features/authz/contract/src/engine.ts`, and every caller uses it:

- The batch case (`batchScopePermissions`, the model-defaults page) is the
  same function taking N scopes. Collect once, decide N times in memory.
- The API-key ceiling is engine algebra, not a parallel resolver:
  `decide(key) ∧ decide(owner)`.
- The four `*.authz.ts` modules become thin **policy tables** (which
  permission applies per scope tier for this resource family) evaluated by
  the engine. Their duplicated `RBACContext`/`Scope` types and `TRPCError`
  throws go away.
- The five hand-synchronised implementations - including the client's - are
  deleted.

`AuthzDecision` is the only output shape. `PermissionResult.organizationRole`

- today's way of smuggling "was this a lite member?" to error-message code -
  is replaced by `denialReason: "lite-member-restricted" | "no-binding" | …`,
  and a denial maps to a `PermissionDeniedError extends HandledError`
  (ADR-045). That fixes today's plain-`Error` throw in `PermissionsService` and
  the `TRPCError`s thrown from supposedly framework-free modules. Step 6
  (RECORD) gives us, for free, the structured authz audit trail that today
  exists only for tRPC error paths.

### 3. Grant semantics: additive union, settled

We keep - and now _specify_ - what the code has always done:

```
 UNION (chosen)                          MOST-SPECIFIC-WINS (rejected, was spec'd)
 admin@org + viewer@chatbot              admin@org + viewer@chatbot
   = admin everywhere                      = viewer on chatbot, admin elsewhere
   (extra binding is inert)                (ADDING a row REMOVES power)

 To narrow someone, grant less:          Why rejected: non-monotonic reasoning -
   delete the broad binding,             every audit answer becomes "it depends
   insert the narrow one                 which OTHER bindings exist"; group vs
   (see REDUCE, above)                   direct bindings at one scope need a
                                         precedence lattice; and union has been
                                         prod behaviour for bindings' whole life.
```

GCP IAM and Zanzibar made the same call for the same reason: monotone grants
are auditable. If explicit restriction ever becomes a product need, we add a
typed `deny` binding as its own reviewed concept - never an implicit
override. The override scenarios in `specs/rbac/scoped-role-bindings.feature`
are superseded by `specs/rbac/unified-authorization-engine.feature` (written
with this ADR).

### 4. Principals, not bolt-ons

Identity resolution happens **once, at the edge**. Every credential type
(session cookie, `sk-lw-…`/`pat-lw-…` key, share token, internal HMAC secret,
demo visit) resolves to a `Principal`, and the ~15 hand-rolled in-handler
auth blocks collapse into that one edge.

```
 Principal = user | api-key | service | share-token | demo-visitor | platform-ops
             (groups are expansion at COLLECT time, not a principal type)

 share token  ─→ ephemeral principal, one grant: traces:view on ONE resource
                 (ShareLink storage stays; ADR-057 already collapsed the old
                  fake-`next` wrapper into resolveForViewer - the engine
                  absorbs that one remaining bespoke check next)
 demo visitor ─→ demo-viewer role bound to the demo project (env config becomes
                 a synthetic binding, not resolver branches)
 platform-ops ─→ ADMIN_EMAILS becomes the one source that grants at the
                 registry's `platform` scope; ops:* joins the vocabulary
                 properly; resolveOpsScope's dead parameters retire
 lite member  ─→ a ROLE (its own permission set) + a separate billing seat
                 classification that authz NEVER reads (fixes the #3388 class);
                 denialReason preserves today's tailored UI messaging
 legacy keys  ─→ NO sunset (decided 2026-08-17): old keys keep working, with
                 no deadline and no customer action. What changes is where
                 their access LIVES - each legacy key is backfilled to explicit
                 bindings mirroring what it can do today, and any key the
                 backfill missed mints its bindings on first use. The
                 `permissions` JSON stops being a decision path and becomes a
                 dormant column, so the bypass branch still dies and a
                 credential is never stronger than its bindings
```

Impersonation becomes a first-class shape instead of a session rewrite. A
principal is an `{ actor, subject }` pair - normally the same identity.
During impersonation the subject is the customer (grants resolve exactly as
theirs) while the actor stays the admin:

```
 normal request          impersonation ("view as customer")
 ┌──────────────┐        ┌──────────────────────────────┐
 │ actor: alice │        │ actor:   admin@langwatch     │ ← keeps their own
 │ subject: ─┘  │        │ subject: customer-user       │   platform-ops grants
 └──────────────┘        └──────────────────────────────┘
 grants resolve for the SUBJECT · every AuthzDecision records BOTH
```

Audit attribution (`metadata.impersonatorId` today), the ops-scope
impersonator carve-out (`rbac.ts:1568`), and the impersonation banner all
stop being special cases - they read straight off `actor`. The same shape
covers linked or secondary account ids: COLLECT already expands a principal
to `{user} ∪ groups`, and linked identities are one more set in that union,
resolved at the identity edge.

`RoleBinding.role`'s scope-dependent enum semantics end. Bindings reference a
role key (`admin` / `member` / `viewer` / `lite-member` / custom-role id),
and a role's meaning comes from its permission set alone. Migration maps
`(scopeType, TeamUserRole)` → role key mechanically.

### 5. Every surface, same idiom (the bones we keep)

The fail-closed builders stay - they are the best part of today's design.
They just all call the one engine:

```
 tRPC      protectedProcedure.permission("prompts:update")       ← input-driven
           (projectId/teamId/organizationId extracted from         scope, no cast
            validated input; today's middlewares become sugar)
 Hono      SecuredApp permission argument (surface unchanged, engine inside);
           the packages/api versioned builder adopts AccessPolicy - its
           `auth: "none"` never ships as a third convention
 services  authz.authorize({ principal, permission, scope })     ← ADR-019: services
           (replaces PermissionsService + the four *.authz.ts)     depend on the port
 workers/  same call with a service or user principal - no more direct-DB
 automations  "trust me" paths
 frontend  useCan("prompts:update") + <RequireCan> backed by ONE
           `authz.effectivePermissions` query (computed server-side by the
           same engine) - the client stops bundling role bags, stops
           re-deriving decisions, and organization.getAll stops patching
           member roles to keep the client honest; the 55 client-side raw
           role comparisons and the endpoint-shape probes become useCan
           calls (the 74 server-side ones become engine/service calls)
 escape    skipPermissionCheck  → noScopedResources({ reason })  ← reason mandatory,
 hatches   authorizeInResolver → authorizeInService({ reason })    enumerable, and
                                                                   deep-key guarded
```

Plus one meta-guarantee, extending #4008 from runtime to CI: a build-time
enumeration asserts that **every** tRPC procedure and Hono route declares a
permission or a reasoned no-permission marker - the Hono route-registry test
generalised to both stacks. The 258-route audit PR #4283 did by hand becomes
a failing test.

### 6. One Access surface, with "why?" built in

Today role management spans five settings pages (members, teams, roles, the
role-bindings audit table, groups) plus the API-key drawer. It becomes one
Access surface whose editor is literally the binding tuple:

```
 Settings → Access
 ┌─ PEOPLE & KEYS ──────┬─ ROLES ──────────────┬─ BINDINGS ────────────────────┐
 │ alice     3 bindings │ admin       built-in │ WHO        ROLE     WHERE     │
 │ sec-eng   1 binding  │ member      built-in │ alice      admin    org acme  │
 │ lw-sk-42  1 binding  │ viewer      built-in │ sec-eng    viewer   team a    │
 │ (SCIM groups appear  │ lite-member built-in │ lw-sk-42   member   proj chat │
 │  here too)           │ "SRE"       custom ✎ │ [+ add binding]               │
 └──────────────────────┴──────────────────────┴───────────────────────────────┘
  add binding = principal picker + role picker + ScopeChipPicker
                (the existing scope component - a binding IS a scope selection)
```

Explainability is not a feature bolted on later. It is the engine's decision
object, rendered. Every denial in the product and every row in the member
list gets a "why?":

```
 "Why can't alice delete this dataset?"
        │
        ▼  authz.explain(alice, "datasets:delete", project:chatbot)
 ┌──────────────────────────────────────────────────────┐
 │ DENIED  datasets:delete @ project chatbot            │
 │                                                      │
 │ collected 2 bindings:                                │
 │  ✗ viewer @ team client-a   (via group sec-eng)      │
 │      grants datasets:view - not delete               │
 │  ✗ member @ org other-co                             │
 │      filtered out: not on chatbot's scope chain      │
 │                                                      │
 │ would grant it: admin, or any custom role holding    │
 │ datasets:delete, bound at chatbot / client-a / acme  │
 └──────────────────────────────────────────────────────┘
```

Because the engine is a pure function over collected bindings, edits get an
impact preview for free: run it twice (current vs draft bindings) and diff
the effective sets - "this change removes `datasets:manage` from 3 people in
2 projects" _before_ save. Registry metadata (per-permission labels and
descriptions) supplies the copy. The matrix codegen (§1) supplies the docs.

### 7. Fail-closed, four layers deep

Fail-safe here means: forgetting the check is not expressible, and if it
somehow happens anyway, the request dies closed.

```
 L1  BUILDERS    you cannot reach .query/.mutation (tRPC) or .get/.post
     compile     (Hono) without declaring an access policy - exists today,
                 kept as-is
 L2  CI SWEEP    build-time enumeration of BOTH stacks: every endpoint
     build       declares a permission or a reasoned escape; a new route
                 with neither is a red build (generalises the Hono
                 route-registry test)
 L3  WITNESSES   repositories stop accepting raw ids and take an authz
     compile     witness instead - see below                        [new]
 L4  BACKSTOP    enforcePermissionCheck + deny-by-default in the engine:
     runtime     unknown scope → deny; malformed custom role → deny + log
```

L3 is the one that changes daily work. `authz.authorize()` returns a branded,
unforgeable proof, and data access demands it:

```
 const chatbot = await authz.authorize({        // the ONLY factory of
   principal,                                   // Authorized<"project">
   permission: "traces:view",
   scope: project(input.projectId),
 });                                             │
                                                 ▼
 tracesRepo.findAll({ project: chatbot })   // takes Authorized<"project">,
                                            // NOT a raw string projectId
 // skipped the check? then you hold no witness, and this line does not
 // compile - the forgotten-guard bug class goes extinct
```

New repositories take witnesses from day one. Existing ones migrate module by
module, with the Prisma projectId guard covering them until then.

### 8. The resource tier: sharing is a grant on the tree

The scope tree grows one level. Individual resources (a trace, a thread) sit
under their project, a share is an ordinary grant row at that node, and the
resource's children need no rows of their own - their chain walks UP through
the parent, exactly the way a project grant already covers every trace in
the project:

```
 Organization acme
 └── Team client-a
      └── Project chatbot
           └── trace t1 ◄──── grant: anyone = traces:view @ resource trace:t1
                ├── spans       ─┐
                ├── logs         │  no rows of their own — a child's chain
                ├── metrics      │  walks up through trace:t1, so the one
                └── evaluations ─┘  grant covers all of them, present and
                                    future (threads work the same, one level
                                    higher: thread → traces → spans)
```

The WHO side generalises too. A resource grant names an **audience**, and
one of the audiences is nobody-in-particular:

```
 share trace t1 with…
   user dave · group sec-eng · api key lw-sk-42     (principals, as everywhere)
   members of team client-a / org acme /            (audience = a membership
     project chatbot                                 set, no enumeration)
   anyone                                           (no session required —
                                                     this IS the public share,
                                                     same engine, same row shape)
```

Request-time it stays one composition - membership first, resource grants
second, one decision either way:

```
                     GET trace t1 (project chatbot)
                               │
                 ┌─────────────┴─────────────┐
                 │ membership: can(principal, │──ALLOW──► audience: member
                 │   traces:view, chatbot)?   │           (full payload)
                 └─────────────┬─────────────┘
                          deny │
                 ┌─────────────┴─────────────┐
                 │ resource grants on t1's    │──ALLOW──► audience per the
                 │ chain, audience matching   │           grant (anyone →
                 │ the caller (incl. anyone)  │           public, redacted)
                 └─────────────┬─────────────┘
                          deny │
                               ▼
                     ONE AuthzDecision: DENY

 route:  .permission("traces:view").orResourceGrant("trace", (i) => i.traceId)
```

Grants are matched on `(kind, id, projectId)` - the project anchor rides
along so a resource id colliding across projects can never leak (#4692's bug
class, closed structurally). The decision's `audience` drives redaction - the
same job ADR-057's share gates do today, driven by one engine verdict instead
of a bespoke resolver. ADR-057's share tokens verify possession and then
resolve to exactly these grants.

**The shim (shipped with the stage-A engine):** ADR-057's `ShareLink` table is already a
resource-grant table in disguise: `(resourceType, resourceId, projectId)` is
the grant anchor, `visibility` is the audience (PUBLIC is anyone,
ORGANIZATION the org, PROJECT the project), and the secret `token` is the
possession credential that activates it. The collector reads presented, live
links as grants of `traces:view` - no schema change, the engine speaks the
general model from day one, and ADR-057's two invariants survive intact: no
presented token means no grant (row existence never authorizes, so the
trace-id-guessing hole stays closed), and expiry and view budgets are
filtered before the engine ever sees a row. View consumption stays in
ShareService, which remains the accounting surface. At an org's cutover (§13) its share
links are imported as RESOURCE-scope rows in the one `Grant` table - token,
expiry and view budget carried, possession semantics untouched - and from
then on ShareService writes are `grants.*` commands like every other
writer. Per-row permission and principal audiences (the annotate-only
customer share) fall out of the same columns; no parallel table ever
exists.

### 9. Resources users create (API keys, personal VKs)

User-created credentials already have the right instinct in-tree - personal
virtual keys are self-visible on `principalUserId` match, no permission
needed (`rbac.ts:34-38`) - but it lives as scattered special cases. The
registry makes ownership a declared fact:

```
 who may touch API key lw-sk-42 (created by dave)?

 owner path    resource.ownerUserId === principal.id     dave: always,
               registry: apiKeys: { ownerImplicit:       no binding needed
                 [view, update, delete, rotate] }
 grant path    bindings → apiKeys:view @ scope           admins, auditors
 cross path    apiKeys:viewOtherPersonal                 off-boarding sweeps -
               (explicit and auditable, never implicit)  org admins

 effective = union of the three - same engine, one decision, and the owner
 path shows up in explain() like any other grant
```

Restricted API keys keep today's genuinely good _model_ - their permission
set is a role (`kind: "system_api_key"`, a `Role` row post-ledger, projected
back into `CustomRole` for the compat view) bound through the same tuple
table - and keep the owner ceiling, `effective(key) = grants(key) ∩
grants(owner)`, so a resource created by a user can never outlive or
out-privilege its creator. The ceiling clamps at check time, never at
creation time, which is why it cannot go stale: a fired owner's grants
intersect every key they own down to nothing in the same moment.

The intersection also settles "I made a key, then my own access changed"
precisely, and asymmetrically on purpose:

```
 you create a key, then YOUR access changes:

                      SCOPED key                    MIRROR key ("act as me")
                      bound "member @ chatbot"      bindings = ⊤, owner is
                      - explicit minted intent        the only limiting term
 you get DEMOTED   →  key shrinks with you (∩)      key shrinks with you
 you get PROMOTED  →  key stays EXACTLY as minted   key grows with you -
                      - a CI key must never           its declared intent
                        silently gain org:manage      is "the key is me"
```

Demotions always propagate (safety). Promotions never leak into a scoped key
(least privilege - growing one is an explicit, audited `grants.update`).
Today's `permissionMode` strings map cleanly: `"all"` is a mirror key,
`"readonly"`/`"restricted"` are scoped, and the create-key UI names the
choice instead of implying it.

Two of today's escapes close as a consequence: service keys with zero
bindings silently defaulting to org-wide ADMIN (`api-key.service.ts:151-161`

- becomes: zero bindings, zero access, creation must bind explicitly), and
  the API-key resolver ignoring lite-member status (Context #10).

### 10. Offboarding: one verb, with proof

"Dave left - make sure every grant he ever had is gone." Today the honest
answer is a manual sweep across six tables in two generations
(`OrganizationUser`, `TeamUser`, `RoleBinding`, `GroupMembership`, `ApiKey`,
personal VKs), with the blind spots Context #4 and #10 document. In the
model, a principal's every capability comes from exactly two enumerable
sources - binding rows, and ownership the registry declares - so removal is
one transaction with a postcondition:

```
 grants.offboard({ who: user(daveId), where: org(acmeId) })

 1 PREVIEW  everything dave currently resolves (bindings by user - the
            reverse index) - shown to the admin BEFORE anything is deleted
 2 DELETE   role bindings        WHERE userId = dave AND org = acme
 3 DELETE   group memberships    (group-derived grants die with them)
 4 REVOKE   personal credentials he owns (API keys, personal VKs) - already
            inert regardless: effective(key) = grants(key) ∩ grants(owner) = ∅
 5 CANCEL   pending invites for his email
 6 ADVANCE  the org's version (epoch today, the projection cursor advances
            with the write itself) → caches and passports die immediately (§12)
 7 PROVE    effectivePermissions(dave, acme) == ∅
            the operation FAILS LOUDLY if anything still resolves
 8 REPORT   a manifest: what was removed, plus what needs a human decision
            (service keys dave created, his personal workspace/projects -
             reassign or archive, never silently kept)
```

The proof step is the point. _"Is dave fully out?"_ becomes an engine query,
not an audit project - and the same query powers a standing "what can dave
touch?" view in the Access surface at any time, not just at departure. The
registry's `ownerImplicit` declarations double as the sweep's checklist: the
categories of principal-owned resources are enumerated by construction, so
the sweep cannot forget one the vocabulary knows about.

Three deliberate edges. Service keys (`userId: null`) are org infrastructure
and are not auto-killed - the manifest flags the ones dave created for
reassignment (this is what `virtualKeys:viewOtherPersonal` was invented for;
the sweep generalises it). SCIM deprovisioning calls the same verb instead of
its own deletion path (`scim.service.ts:452` today). And history survives:
bindings are deleted, but the audit stream keeps who held what, when, and
which binding decided each access - "every grant they've _ever_ had" stays
answerable for SOC 2 review even after revocation. Because there is no
default access anywhere (§3), a hypothetically missed row is a _visible_
binding that an access review or the dormant-binding detector will surface.
Never invisible ambient access.

### 11. The API (setting, checking)

Named parameters, typed permission strings, call sites that read like the
sentence they perform:

```ts
// ---- checking ---------------------------------------------------------
await authz.can({ principal, permission: "prompts:update", scope: project(id) });
// → boolean

await authz.authorize({ principal, permission: "prompts:update", scope: project(id) });
// → Authorized<"project"> witness · throws PermissionDeniedError(denialReason)

await authz.check({ ... });           // → full AuthzDecision, never throws
await authz.checkMany({ principal, permission, scopes });  // batch, one collect
await authz.effectivePermissions({ principal, scope });    // feeds useCan()
authz.explain(decision);              // → the walk, human-readable (§6)

// ---- setting ----------------------------------------------------------
await grants.attach({ who: user(aliceId),   role: "viewer",           where: project(chatbotId) });
await grants.attach({ who: group(secEngId), role: "member",           where: team(teamAId) });
await grants.attach({ who: apiKey(keyId),   role: customRole(sreId),  where: org(acmeId) });

await grants.update({ grantId, role: "member" });
await grants.revoke({ grantId });                 // instant enforcement (§13)
await grants.replace({ who: user(aliceId), from: org(acmeId),   // the REDUCE
                       to: team(teamAId), role: "member" });    // verb

// every write: validates against the registry, appends to the ledger
// (waited), advances the org's projection cursor, and lands an AuditLog row
// via the insert-only subscriber (§13). The 8 places that write RoleBinding
// rows today (member add, invites, SCIM, groups, API keys, project creation,
// role editor, better-auth hooks) all route through grants.* — SCIM as a
// reconciler: diff the IdP's declared state against the projection, emit
// only the difference (removals carry instant enforcement).
```

tRPC and Hono sugar stays declarative -
`protectedProcedure.permission("prompts:update")`,
`.permission("traces:view").orPublicResource("trace", i => i.traceId)`,
`SecuredApp`'s `requires("…")` - all compiling down to `authz.authorize`.

### 12. Instant checks: the epoch ladder (no DB on the hot path)

Freshness today comes from hitting Postgres on every check. Keep the
freshness, drop the round trips, with one tiny invalidation primitive:

```
 WRITE SIDE                              READ SIDE (hot path)
 grants.attach / update / revoke         can(alice, perm, scope)?
      │                                       │
      ├── write binding row (PG)              ├─ L0 request memo    same request:
      │                                       │                     free
      └── bump org authz epoch ─────┐         ├─ L1 process cache   epoch match?
          one integer per org,      │         │   principal→grants  bitset test,
          fanned out via pub/sub    └───────► │   as bitsets        ~µs, NO DB
                                              └─ miss / stale epoch?
                                                 collect once from PG,
                                                 re-cache under the new epoch

 L2  cross-service / stateless surfaces (collector, Go gateway, share links):
     signed passport = { principal, scope→permission-bitmap, epoch, exp ≤60s }
     verify = HMAC + in-memory epoch compare → zero DB, revocation ≤ fanout lag
```

The registry makes this cheap. It is a fixed ordered list of valid pairs, so
an effective permission set per scope is a bitset a few dozen bytes wide
(~40 bytes covers the whole vocabulary, a fully cached principal is under a
kilobyte), and "does alice hold `prompts:update` here?" is a bit test. The
latency budget, stated as targets PR 5's shadow comparison must confirm:

```
 path                              cost                   when
 ─────────────────────────────────────────────────────────────────────────────
 L0  same-request memo             ~100 ns                repeat check, same req
 L1  cache hit (epoch matches)     < 1 µs · ZERO queries  steady state - nearly
                                                          every check, every day
 L1  miss (grant changed / boot)   1-5 ms · 2 queries     first check per
                                   (collect + re-cache)   principal per epoch
 L2  passport verify               ~2 µs · zero DB,       collector, gateway,
                                   zero PG connection     share links
 ─────────────────────────────────────────────────────────────────────────────
 today, EVERY check                3-10 ms · 3-5 queries  resolveProjectPermission:
                                   sequential             project lookup + groups
                                                          + bindings + custom role
```

Today's cost is not hypothetical - `batchScopePermissions`' own docstring
says the quiet part: one scoped check costs "~3-5 queries", and N checks in a
`Promise.all` fan-out were "hundreds of queries per page load on large orgs"
(`rbac.ts:1113-1132`). The steady-state check drops three to four orders of
magnitude and stops touching the database at all. The cache-miss path costs
what every single check costs today. The precedent is already in-house - the
gateway's 15-minute HS256 JWT with a `revision` claim
(`server/gateway/gatewayJwt.ts`) is exactly this pattern for virtual keys,
and epochs generalise it to every principal. A revoked binding is dead on the
caller's next request, so the no-stale-grants property survives, minus the
per-check query tax.

**2026-08-17: the version integer is the projection cursor, not a bumped
epoch.** The original design hand-bumped a per-org epoch on every write and
therefore carried a precondition ("holds only once _every_ write path bumps
it" - the old delivery-plan gate M7) and a flag to hold it closed until then.
The grants ledger (§13) dissolves the precondition: the per-org version is
`AuthzProjectionCursor`, advanced by the projection writer itself - the write
_is_ the bump, so no write path can skip it and no runbook gate is needed.
The Redis epoch store that stage B shipped keeps being bumped unchanged until
the contract PR retires it in favour of the cursor (delivery-plan decision
19). The coarseness is deliberate either way: one version per org means any
grant write re-collects every cached principal in that org once. Grant writes
are rare, and a re-collect is the same 1-2 queries the engine already does.

### 13. Storage and rollout: the grants ledger (rewritten in place, 2026-08-17)

\*This section replaces the original "six shippable stages" (A-F) plan. The
stage names survive only as labels for work already merged: A = the engine
(#6894), B = the self-migration (#7079). The full delivery detail - shapes,
event vocabulary, PR bills of materials, pre-flight facts, testing doctrine

- lives in `dev/docs/adr/110-grant-aggregates-are-grants.md` (21 dated
  decisions); what follows is the decision itself.\*

**Grants are event-sourced.** The ClickHouse `event_log` is the single
source of truth for every access fact (aggregate `authz_grants`,
`aggregateId = organizationId`); Postgres holds fold projections that every
authz check reads. Checks **never** read ClickHouse.

```
  command (attach / revoke / offboard / define role / cutover …)
      │
      ▼
  ClickHouse event_log ── append is WAITED (async_insert +
      │                   wait_for_async_insert, ADR-022 event_log)
      │
      ├─► fold projections (Postgres):   Grant / Role      ← the future
      │                                  RoleBinding /     ← legacy-shaped
      │                                  CustomRole          compat view
      │
      └─► audit subscriber: INSERT-only AuditLog rows
          (id derived from eventId, ON CONFLICT DO NOTHING, never an
           update; when-guard skips genesis/backfill/mint sources so
           cutover cannot flood the audit page; subscribers are excluded
           from replay by the Eventing subscriber contract - the existing
           audit UI is untouched)

  ONE writer, TWO views, ONE subscriber. Application code never writes
  Grant, Role, RoleBinding, CustomRole, or grant AuditLog rows directly.
```

**Dispatch: the queue, best-effort FIFO.** Every command appends (waited) and folds
through the GroupQueue in per-org FIFO. The ordering authority is the append
itself — `(acceptedAt, eventId)` is the ledger's order, the projection
follows it, and we accept that order as **best-effort FIFO**: it is the
order ClickHouse accepted the events, which is the only order the system
has. **No fold ever runs inline — not in normal operation and not during an
outage.** If Redis is down, this decision's named-pipeline circuit breaker
guarantees exactly three things, and inline
processing is deliberately not among them:

- **Appends still land.** The event store is ClickHouse and the append is
  waited, so the fact is durable whether or not a queue job could be staged.
- **Revocation still bites.** The revocation class applies its sanctioned
  direct projection write on the calling path (see below), so the outcome
  holds even though the fold has not run.
- **Everything else waits.** Folds, subscribers and replays do not run while
  Redis is down. There is no in-memory processor and no in-process drain;
  projections catch up when Redis returns, and a replay is never attempted
  during an outage.

That is what keeps the queue-ordering contract above true: there is one
order — the append order — and one thing that applies it.

**Revocation is instant anyway — as enforcement, not as a fold.** For
`grants.revoke`, `member_offboarded`, and `cutover_rolled_back`, after the
append is accepted the service synchronously applies the _deny effect_ on
the calling path: it deletes the affected `Grant` projection rows right
there, without waiting for the queue. The fold later applies the same event
in its FIFO position; deleting an absent row is a no-op, so early
enforcement and ordered convergence coexist. Redis never gates a
revocation: with the queue down, the append and the enforcement still
happen and the fold catches up when the queue returns. This is the **one
sanctioned direct projection write** by application code — the "one writer"
doctrine's single named exception — and it is shaped so it can only make
_deny_ true early, never grant. Known edge, accepted: revoking a grant
whose attach event is still queued deletes nothing (no row yet); the attach
then the revoke apply in order and the state converges to revoked.

**Doctrines** (nothing else backs these; this ADR does):

- **No transactions.** Every step is retryable and idempotent: waited
  append, deterministic event-derived ids (grant ids and audit row ids are
  functions of event content), cursor-guarded apply, insert-if-absent audit.
- **Two timestamps.** `occurredAt` is business time (backfilled facts carry
  the legacy row's `createdAt`); `acceptedAt` is ledger time; the cursor
  orders on `(acceptedAt, eventId)` (the house pair).
- **Migration emits normal events**, distinguished only by `source`
  (`genesis-import`, `backfill-b`, `read-through-mint`) and backdated
  `occurredAt` - one reducer path, so replay exercises the live code. Only
  process facts get their own events (`migration_parity_proved`,
  `cutover_completed`, `cutover_rolled_back`).
- **Appends are batched per org** - efficiency comes from batching, not from
  fattening events.
- **`Grant` and `Role` are born as new, clean tables** - never a rename of a
  live table. The compat projection keeps the legacy path reading
  `RoleBinding`/`CustomRole` until contract. As a new org-scoped
  `(scopeType, scopeId)` model, `Grant` joins the tenancy-guard regime
  ADR-021 defines (and flags today's org-scoped models for lacking).

**Rollout: build dark → per-org cutover → contract.** All code ships to
production gated closed by the migration state itself (the stage-B
per-tenant state machine, whose lifecycle transitions become ledger events
with `SystemMigrationTenantState` as their projection - same table, same
ops page, same legacy-fallback gate). An org cuts over **all at once,
never half**: import its remaining facts (EXTERNAL → lite-member, legacy
keys, the org-member floor row, per-user zero-binding legacy ADMIN grants,
its share links → RESOURCE grants, `ADMIN_EMAILS` → PLATFORM grants) →
parity proof over every registry permission → `cutover_completed` → the
fork at the ten existing seams (7 in `rbac.ts`, 3 in
`role-binding-resolver.ts`) flips that org to engine-primary with legacy as
reverse-shadow. Any parity diff **holds** the org - behaviour unchanged,
diffs in the report, re-proved next pass; `held` is a designed steady
state, not failure. Rollback is `cutover_rolled_back` (instant enforcement), live
within the gate's cache TTL, no deploy. Our own org first, in production,
end to end; then the cohort widens self-service-first. Every deletion -
the legacy resolvers, the quirk branches, the compat projection, the old
tables, the fork and gate themselves, the epoch store - waits until 100 %
of tenants are finalized (the contract PR). Public REST names
(`/role-bindings`, the `bindings` wire shape,
`role_binding_already_exists`) are customer contracts and stay frozen
forever; the Grant/Role rename never leaks to the wire.

Delivered as 4+1 PRs (plan doc, "The PR map"): **1** same position
event-sourced (proof: replaying an org's stream is byte-identical to the
imperative writer, and `specs/migration/authz-grants-rollout.feature` passes
unchanged) · **2** the ledger becomes the only writer (genesis import;
eight write paths become command emitters; SCIM reconciler; audit
subscriber) · **3** the cutover machine and the fork · **4** the contract ·
**5** accelerate (passports and the L1 cache keyed on the cursor),
independent.

Both candidates closed on 2026-08-17, leaving **no customer-visible
permission change at all**:

- **Legacy API keys: no sunset.** Old keys keep working indefinitely. The
  backfill moves where their access is stored, not what it grants, so
  nothing a customer holds stops working and no comms are owed.
- **Empty custom roles: the role means what it says (deny).** Today an empty
  custom role falls through to the binding's built-in role
  (`matchers.ts`: "Non-empty custom role is authoritative; empty/missing
  falls through"), quietly granting more than the UI shows. Measured against
  production on 2026-08-17: of 464 custom roles, **zero** are empty and
  **zero** carry only strings outside the 126-permission registry. The
  change is real but its blast radius is empirically nil, so it ships
  without a remediation path.

## What falls out for free (not being decided here)

None of the following is being decided in this ADR. They are listed because
once grants are tuples, decisions are one object, and ceilings are set
algebra, each one stops being a project and becomes a row shape or a
one-liner:

- **Expiring bindings** - an `expiresAt` column filtered at COLLECT:
  time-boxed contractor access, break-glass elevation with automatic
  revocation.
- **Access requests** - a pending binding awaiting approval; `explain()`
  already names the role that would grant, so every denial can carry a
  one-click "request access".
- **Delegation** - `effective(delegate) = grants(delegate) ∩ grants(delegator)`;
  the API-key owner ceiling generalised to humans.
- **Agent principals** - a Langy chat session gets an ephemeral principal =
  Langy's service role ∩ the invoking user (issue #4977's caller-scoped
  keys); the confused-deputy fix falls out of the ceiling algebra.
- **Richer share links** - door 2 tokens can carry any single grant, not
  just view: an annotate-only share for a customer, a dataset-contribute
  link.
- **Linked / secondary accounts** - one human, several identities: COLLECT
  already unions `{user} ∪ groups`, linked ids are one more set (§4).
- **Access reviews / SOC 2 evidence** - the matrix codegen plus a bindings
  dump _is_ the quarterly review artefact; "who can see PII in project X" is
  one engine query.
- **Authz anomaly detection** - the AuthzDecision stream (step 6, RECORD)
  feeds the existing governance activity monitor: denial spikes, dormant
  admin bindings, first use of a powerful grant.
- **What-if simulation** - the engine is pure, so "what would change if we
  shipped this role edit" runs org-wide on draft bindings (§6's preview,
  generalised).
- **New scope levels** - the tree is data; adding, say, `environment` under
  project is a registry + resolver change made once, not once per surface.

## Rationale / Trade-offs

**Why an in-repo engine and not a policy service (OpenFGA, SpiceDB, Cerbos,
Oso)?** LangWatch ships self-hosted. A mandatory stateful authz sidecar is a
real adoption tax, and every check becomes a network hop. Our scope graph is
a fixed three-level tree with group expansion - the part of Zanzibar we need
is the _tuple model_, which `RoleBinding` already is. We take the ideas
(tuples, union semantics, one decision API) without the infrastructure. If we
ever need cross-org relation graphs, the engine's `can()` seam is where an
external system would slot in.

**Why not CASL or casbin?** They give a runtime ability DSL but solve none of
our actual problems - vocabulary drift, dual-generation storage, five-surface
duplication - while adding a second language for reviewers to learn. Our
checks are set membership after a union. TypeScript with a typed registry
expresses that with better exhaustiveness than either library.

**Why not Postgres RLS?** Half our reads are ClickHouse, and app-level roles
crossed with RLS policies are notoriously hard to test and reason about.
Tenancy-by-ID guards (ADR-021) stay the SQL-layer defence. Authz stays
application logic.

**Why settle union vs override now?** Because it is currently _unsettled in
writing_ while settled in behaviour - the worst of both. Choosing union
matches the entire production history of role bindings, keeps grants monotone
(auditable), and costs us only spec scenarios nobody has ever exercised.

**Why does the client get a computed permission set instead of the bags?**
Because the client re-deriving decisions is how we got a fifth resolver, a
role-promotion hack in `organization.getAll`, and the empty-custom-role
drift. One `effectivePermissions` query makes the server's answer the only
answer. The shared registry keeps permission strings type-checked in `.tsx`.

**What we're accepting:** quite some mechanical migration (≈380 middleware
attach-sites, ~15 in-handler auth blocks, 129 raw role comparisons, 8+
RoleBinding write paths to align on one service), a temporary period where
shadow mode doubles resolver query load, the retirement of spec scenarios
that promised override semantics, and two deliberate behaviour changes
(legacy-key sunset, empty-custom-role semantics). Custom roles stored as
permission arrays (not references) stay as-is - registry validation plus a
startup sweep for orphaned strings is enough, and normalising them is
deliberately out of scope.

## Consequences

- **Positive:** one place answers every authz question; adding a resource is
  a registry entry; the role matrix is reviewable in PR diffs; API keys,
  shares, demo, ops, and lite members stop being special; the #4283 audit
  class becomes a CI failure instead of a heroic manual sweep; issues #1247,
  #4008, #3429, and the #3388 class are closed by construction; the frontend
  can no longer drift from the backend on what a permission means, because
  it no longer computes anything.
- **Negative:** weeks of staged migration effort; everyone re-learns
  "binding grants role at scope, union, no override" (the diagrams above are
  the teaching aid); shadow mode is temporary complexity; no behaviour
  change needs customer comms (both candidates closed 2026-08-17 - no key
  sunset, and empty-role-deny measured at zero blast radius); an in-repo
  engine means _we_ own performance (mitigated: the engine's
  collect-once/decide-many shape is strictly fewer queries than today's
  per-check fan-out, and §12's version cache - new machinery we must
  observe - ships shadow-compared before it is trusted).
- **Neutral:** the Go services keep validating their own tokens and calling
  back with service principals; ADR-021's tenancy guards are complementary
  (the new `Grant` table joins them); grant freshness is preserved via the
  per-org projection cursor rather than by hitting Postgres on every check.
- **Changed 2026-08-17:** Prisma storage is no longer "barely changed" -
  `Grant` and `Role` are new tables fed by the event ledger (§13), with the
  old tables continuing as derived compat views until contract. The cost is
  deliberate: this is the last rewrite of this flow, and correct beats
  expedient everywhere the two diverge.

## Amendment 2026-08-24: a disabled membership is not a membership

The membership gate reads `OrganizationUser`, and that row has carried a
`disabledAt` column since seat reconciliation shipped: an admin over their
licensed seats disables people to get back within them, and the row survives
with its role, department and history so re-enabling restores everything
(`specs/licensing/seat-reconciliation.feature`).

Nothing on the authorization path read that column. The organization switcher
filtered it, `getOrganizationWithMembers` filtered it, and the member list
filtered it, so the organization vanished from a disabled person's UI — while
`findOrganizationRole`, every binding fence, the API-key ceiling and the
virtual-key membership set all read the row as if it were live. A disabled
member kept every permission they had, reachable by direct URL, tRPC call or
REST call. The legacy resolver had the same hole, so this is not a regression
the engine introduced; it is one it inherited and now closes.

**Decided.** Membership means ACTIVE membership, everywhere authorization asks:

- The read port returns the row as a fact — `{ role, disabled }` — and the
  collector applies the policy, setting `isOrgMember` false and
  `organizationRole` null for a disabled row. Filtering in SQL would have made
  a disabled membership indistinguishable from an absent one, and the denial
  could then only have claimed the person was never here.
- Binding reads keep filtering in SQL (`disabledAt: null` on the membership
  fence), because those queries return grants and have no fact to hand back.
- Denials say `membership-disabled`, not `no-membership`. We know the cause
  and the person can act on it — an admin can return their seat — which is the
  ADR-045 test for a named error rather than a generic one.
- Disabling and re-enabling bump the organization's authz epoch. Disabling is
  a plain column write, so nothing else retires the snapshots §12 caches, and
  an admin's revocation must not wait out a cache.

**Inventory reads are deliberately untouched.** The legacy-import migration
still imports a disabled member's grants (they are preserved for re-enable),
and the listing repositories still list them (an admin has to see somebody to
re-enable them). Only reads that answer "may this principal act?" changed.

**Consequence worth stating plainly:** the §9 owner ceiling means a disabled
member's personal API keys stop working, because `effective(key) =
grants(key) ∩ grants(owner)`. That is the point — a person cut off from an
organization must not keep a live credential to it — but it reaches past their
own session, so any automation running on their key stops with them. Service
keys, which have no owner, are unaffected.

**Write-side membership reads were left alone on purpose.**
`assertUsersInOrganization` and `group.isUserInOrganization` still let a
disabled user be _granted_ access. That is inert: the grant confers nothing
while the seat is off, and it is waiting for them when it comes back on.

## References

- Supersedes: [ADR-001](./001-rbac.md) (its hierarchy + `resource:action` format live on).
- Related: [ADR-019](./019-repository-service-layering.md) (authz as a service-layer
  port), [ADR-021](./021-multi-scope-targeting-and-tenancy.md) (tenancy anchors,
  org-exclusive rule - absorbed into the registry), [ADR-045](./045-domain-errors-handled-boundary.md)
  (`PermissionDeniedError` as a `HandledError`).
- Related: [ADR-057](./057-token-gated-trace-sharing.md) (token-gated trace
  sharing, PR #5809) - its `ShareLink` table is the resource tier's storage
  until an org's cutover imports the rows into `Grant` (§8, §13); its
  possession-not-existence invariant is preserved by the collector either way.
- The ledger's lineage (all §13): [Eventing framework boundary](../../../packages/eventing/adrs/20260820-eventing-framework-boundary.md)
  (the pipeline architecture; its web-role rule holds unchanged — the
  instant-enforcement write is a service write, not inline processing), [ADR-022](./022-event-log-source-of-truth.md) (_event_log
  as single source of truth_ - cite by title, two files share the number;
  the waited `async_insert` append is its pattern; `leanForProjection`
  conformance is a no-op here, no heavy fields),
  [ADR-015](../../../packages/eventing/adrs/015-projection-replay-coordination.md) (the replay protocol
  the byte-identical replay test rides),
  [Eventing framework boundary](../../../packages/eventing/adrs/20260820-eventing-framework-boundary.md)
  (subscriber vocabulary; subscribers excluded from replay - what makes the
  insert-only audit subscriber safe), [ADR-093](./093-redis-is-an-owned-client.md)
  (Redis ownership; instant enforcement never touches it),
  [ADR-049](./049-langy-projection-independent-reactions.md)
  (store-before-dispatch, preserved verbatim by waiting the append).
- Related: [ADR-070](./070-modular-package-architecture.md) (bounded-context
  packages) and the
  [AuthZ feature boundary](../../../packages/features/authz/adrs/001-package-boundary.md).
  `@langwatch/authz-contract` is the Prisma-free, env-free, browser-safe
  vocabulary and decision core. `@langwatch/authz-server` owns concrete
  services and private infrastructure; the application runtime root composes
  them and the process-role-aware preset selects consumers without exposing
  repositories to ordinary callers.
- Spec: `specs/rbac/unified-authorization-engine.feature` (this ADR);
  supersedes the override scenarios in `specs/rbac/scoped-role-bindings.feature`.
- Delivery: [ADR-110](110-grant-aggregates-are-grants.md) carries the final
  aggregate shapes, event vocabulary and rollout model (the standalone
  delivery-plan doc was retired into it).
- Evidence: `dev/docs/security/hono-api-rbac-audit.md` (PR #4283); issues
  #1247, #3388, #3429, #3685, #4008; `git log --since=2026-01-01 --
langwatch/src/server/api/rbac.ts` (28 commits).
