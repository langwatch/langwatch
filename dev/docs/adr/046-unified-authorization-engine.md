# ADR-046: Unified authorization engine - one registry, one resolver, every principal

**Date:** 2026-07-16

**Status:** Proposed (supersedes ADR-001 when accepted)

## Decision, in one paragraph

We will collapse LangWatch authorization into a single `server/authz/` module
built from three nouns - **permission** (a verb on a resource), **role** (a
named set of permissions), **role binding** (who holds which role, where) -
resolved by **one engine** that every surface (tRPC, Hono, services, workers,
frontend) and every principal (user, API key, share token, demo visitor,
platform ops, with group membership expanded into user grants) goes through.
The permission vocabulary becomes a typed registry that knows what each
resource can do. Grant semantics become an explicit additive union. The legacy
`TeamUser`/`OrganizationUser` role paths get backfilled into role bindings and
deleted, and every decision emits one auditable record. Part II (§6-§12)
covers operating it: one Access surface with "why?" built in, fail-closed
enforcement down to the type level, a composable public-resource door for
share links, owner-implicit grants on user-created resources, offboarding as
one proven verb, the setting/checking API itself, and epoch-validated checks
that skip the database on the hot path.

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
*"can alice update this prompt?"* - is answered by different code depending
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
   literal *"must stay in sync with…"* comment (`rbac.ts:832`,
   `role-binding-resolver.ts:239`). They have already diverged: the tRPC
   resolver caps org-scoped bindings for EXTERNAL users (`rbac.ts:807`), the
   API-key resolver applies no such cap
   (`role-binding-resolver.ts:249-257`). The server even patches the
   client's copy from the outside - `organization.getAll` promotes
   binding-only admins into the exposed member-row role so the client hook
   stays honest (`routers/organization.ts:233-245`).

2. **The spec and the code disagree on the core semantic.**
   `specs/rbac/scoped-role-bindings.feature` specifies
   *most-specific-scope-wins* ("Project-level binding **overrides**
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
   database. Which actions a resource *actually* supports lives in four
   disconnected places: the role bags (`rbac.ts:168-437`, roughly 200
   hand-ordered lines where ADMIN and MEMBER are near-duplicate lists
   maintained by eye), a roles-UI if-chain (`utils/permissionsConfig.ts:40`)
   that omits every gateway resource, API-key read/write bundles
   (`server/api-key/permission-categories.ts`, where "write" on `project`
   quietly includes `project:delete`), and the permission-picker's own
   client-side hierarchy rules (`PermissionSelector.tsx:60-110`) which differ
   from the server's (`rbac.ts:484-492`). The drift is measurable. A custom
   role can *store* `virtualKeys:manage` but the UI can neither author nor
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
   authoritative for EXTERNAL restrictions but explicitly *not* for ADMIN
   power (`rbac.ts:1050-1057`) - the same column means different things
   depending on its value. Meanwhile six `where: { role: "ADMIN" }` queries
   (usage-limit notifications, langy attribution, `resolveOrgAdminEmail`,
   more) read only `OrganizationUser`, so **binding-only admins are invisible
   to them**. The UI says admin, the notification fan-out finds nobody
   (issue #3429's bug class).

5. **One enum, scope-dependent meaning.** `RoleBinding.role` reuses
   `TeamUserRole`. At team scope ADMIN means the team bag. At org scope ADMIN
   means *everything* and MEMBER means *the org bag only* - special-cased at
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
    every workflow payload (`addEnvs.ts:21-69`), so studio and evaluation
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
189 routes without a permission regression test**. Those gaps exist *because*
enforcement is per-surface. Issues #1247 (consolidate the permission
modules), #4008 (type-level permission enforcement for Hono), #3685
(governance granularisation), #3429 and #3388 all ask for pieces of the same
fix. ADR-001 itself now cites a helper (`checkPermissionOrThrow`) and a file
(`permission.ts`) that no longer exist.

### The bones worth keeping

This ADR is a consolidation, not a rewrite of the data model. Five things in
today's design are genuinely good and survive intact:

- the `resource:action` vocabulary and the `RoleBinding` storage model - it
  *is* a Zanzibar-style tuple store, groups and API keys included;
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
 server/authz/registry.ts
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

Built-in roles are declared in the same module *as differences, not
duplicates*:

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
`server/authz/engine.ts`, and every caller uses it:

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

We keep - and now *specify* - what the code has always done:

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
                 (PublicShare storage stays; the wrapper middleware that calls
                  the real check with a fake `next` and catches UNAUTHORIZED
                  goes; aligns with the ADR-039 token-share surface, PR #5809)
 demo visitor ─→ demo-viewer role bound to the demo project (env config becomes
                 a synthetic binding, not resolver branches)
 platform-ops ─→ ADMIN_EMAILS becomes the one source that grants at the
                 registry's `platform` scope; ops:* joins the vocabulary
                 properly; resolveOpsScope's dead parameters retire
 lite member  ─→ a ROLE (its own permission set) + a separate billing seat
                 classification that authz NEVER reads (fixes the #3388 class);
                 denialReason preserves today's tailored UI messaging
 legacy keys  ─→ the full-RBAC-bypass grandfather path gets a dated sunset:
                 backfill each legacy key to explicit bindings mirroring what
                 it can do today, then delete the bypass branch - a credential
                 must never be stronger than its bindings
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
 services  authz.require({ principal, permission, scope })       ← ADR-019: services
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
2 projects" *before* save. Registry metadata (per-permission labels and
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

L3 is the one that changes daily work. `authz.require()` returns a branded,
unforgeable proof, and data access demands it:

```
 const chatbot = await authz.require({          // the ONLY factory of
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

### 8. The public-resource door (authenticated unless shared)

"Members only - unless THIS one trace was shared" is one composition, not a
wrapper hack:

```
                     GET trace t1 (project chatbot)
                               │
                 ┌─────────────┴─────────────┐
                 │ door 1 - membership        │──ALLOW──► audience: member
                 │ can(principal,             │           (full payload)
                 │     traces:view, chatbot)? │
                 └─────────────┬─────────────┘
                          deny │
                 ┌─────────────┴─────────────┐
                 │ door 2 - the RESOURCE      │──ALLOW──► audience: public
                 │ share row / signed token   │           (redacted payload)
                 │ for exactly t1?            │
                 └─────────────┬─────────────┘
                          deny │
                               ▼
                     ONE AuthzDecision: DENY

 route:  .permission("traces:view")
           .orPublicResource("trace", (input) => input.traceId)
```

Door 2 is still the engine: the share row (or ADR-039 signed token) resolves
to an anonymous principal holding exactly one resource-scoped grant. The
decision carries `audience`, and serialisers redact on it - replacing today's
`ctx.publiclyShared` flag and the fake-`next` wrapper middleware.

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

Restricted API keys keep today's genuinely good storage - their permission
set *is* a `CustomRole` row (`kind: "system_api_key"`) bound through the same
tuple table - and keep the owner ceiling, `effective(key) = grants(key) ∩
grants(owner)`, so a resource created by a user can never outlive or
out-privilege its creator.

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
 6 BUMP     the org authz epoch  → caches and passports die immediately (§12)
 7 PROVE    effectivePermissions(dave, acme) == ∅
            the operation FAILS LOUDLY if anything still resolves
 8 REPORT   a manifest: what was removed, plus what needs a human decision
            (service keys dave created, his personal workspace/projects -
             reassign or archive, never silently kept)
```

The proof step is the point. *"Is dave fully out?"* becomes an engine query,
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
which binding decided each access - "every grant they've *ever* had" stays
answerable for SOC 2 review even after revocation. Because there is no
default access anywhere (§3), a hypothetically missed row is a *visible*
binding that an access review or the dormant-binding detector will surface.
Never invisible ambient access.

### 11. The API (setting, checking)

Named parameters, typed permission strings, call sites that read like the
sentence they perform:

```ts
// ---- checking ---------------------------------------------------------
await authz.can({ principal, permission: "prompts:update", scope: project(id) });
// → boolean

await authz.require({ principal, permission: "prompts:update", scope: project(id) });
// → Authorized<"project"> witness · throws PermissionDeniedError(denialReason)

await authz.check({ ... });           // → full AuthzDecision, never throws
await authz.checkMany({ principal, permission, scopes });  // batch, one collect
await authz.effectivePermissions({ principal, scope });    // feeds useCan()
authz.explain(decision);              // → the walk, human-readable (§6)

// ---- setting ----------------------------------------------------------
await grants.attach({ who: user(aliceId),   role: "viewer",           where: project(chatbotId) });
await grants.attach({ who: group(secEngId), role: "member",           where: team(teamAId) });
await grants.attach({ who: apiKey(keyId),   role: customRole(sreId),  where: org(acmeId) });

await grants.update({ bindingId, role: "member" });
await grants.revoke({ bindingId });
await grants.replace({ who: user(aliceId), from: org(acmeId),   // the REDUCE
                       to: team(teamAId), role: "member" });    // verb, atomic

// every write: validates against the registry, emits an audit event, bumps
// the org's authz epoch (§12). The 8 places that write RoleBinding rows
// today (member add, invites, SCIM, groups, API keys, project creation,
// role editor, better-auth hooks) all route through grants.*
```

tRPC and Hono sugar stays declarative -
`protectedProcedure.permission("prompts:update")`,
`.permission("traces:view").orPublicResource("trace", i => i.traceId)`,
`SecuredApp`'s `requires("…")` - all compiling down to `authz.require`.

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
latency budget, stated as targets the stage-F shadow comparison must confirm:

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
caller's next request (the epoch bump outruns any TTL), so the
no-stale-grants property survives, minus the per-check query tax. The
coarseness is deliberate: one epoch per org means any grant write re-collects
every cached principal in that org once. Grant writes are rare, and a
re-collect is the same 1-2 queries the engine already does.

### 13. Migration: six shippable stages

```
 A  EXTRACT   server/authz/ registry + engine + AuthzDecision.
              Characterization tests generated from the registry
              (role × permission × scope matrix vs today's answers).
              SHADOW MODE flag: run engine alongside legacy on real traffic,
              log mismatches, fix until silent.                    [no behaviour Δ]

 B  BACKFILL  TeamUser / OrganizationUser roles → RoleBindings
              (idempotent script; dual-write already exists for new rows).
              Delete the legacy fallbacks - only 2 files still read TeamUser
              for authz (rbac.ts, virtualKey.authz.ts).
              OrganizationUser.role becomes billing/seat data only; the six
              `where: { role: "ADMIN" }` readers (notifications, langy
              attribution, admin-email resolution) move to a binding-aware
              `findOrgAdmins()` helper.

 C  RE-KEY    RoleBinding.role enum → roleKey (admin/member/viewer/
              lite-member/custom:<id>); delete the org-scope special cases.
              Backfill legacy API keys to explicit bindings; delete the
              full-access bypass. Rewrite scoped-role-bindings.feature to
              union semantics.

 D  RE-ATTACH .permission() sugar lands; codemod the 302 project + 76 org
              + 5 team attach sites (mechanical - same permission strings);
              collapse the ~15 handlerManagedAuth copies into edge identity
              resolution; triage 23 skips + 16 resolver-authz sites into the
              new named escapes; fold imperative second-phase checks into
              service-level authz.require.

 E  DERIVE    Roles UI, API-key categories, docs, useCan, and the CI
              route-coverage test all read the registry; delete
              permissionsConfig.ts, permission-categories.ts, the client
              resolver, and the rbac.ts monolith. ADR-001 → Superseded.

 F  ACCELERATE org authz epochs + the L1 cache land behind a flag (shadow-
              compared exactly like stage A); signed passports roll out per
              stateless surface (collector, Go gateway, ADR-039 share
              links); witness types (§7) become the convention for new
              repositories.
```

Each stage merges independently and is verifiable - stage A's shadow
mismatch telemetry is the safety net for B-D, and again for F. No big-bang
cutover, no downtime, and no customer-visible permission change except
deliberate, spec'd ones. There are two: the legacy-API-key sunset (C), and
the empty-custom-role fallthrough (today the server quietly permits
viewer-level; the role becomes exactly what it says, which is what the UI
already shows).

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
  dump *is* the quarterly review artefact; "who can see PII in project X" is
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
is the *tuple model*, which `RoleBinding` already is. We take the ideas
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

**Why settle union vs override now?** Because it is currently *unsettled in
writing* while settled in behaviour - the worst of both. Choosing union
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
  the teaching aid); shadow mode is temporary complexity; two behaviour
  changes need customer comms (legacy keys especially - they are the oldest
  credentials in the field); an in-repo engine means *we* own performance
  (mitigated: the engine's collect-once/decide-many shape is strictly fewer
  queries than today's per-check fan-out, and §12's epoch cache - new
  machinery we must observe - ships flagged and shadow-compared before it is
  trusted).
- **Neutral:** Prisma storage barely changes (backfill plus one role-key
  column); the Go services keep validating their own tokens and calling back
  with service principals; ADR-021's tenancy guards are untouched and
  complementary; grant freshness is preserved via org-level epochs rather
  than by hitting Postgres on every check.

## References

- Supersedes: [ADR-001](./001-rbac.md) (its hierarchy + `resource:action` format live on).
- Related: [ADR-019](./019-repository-service-layering.md) (authz as a service-layer
  port), [ADR-021](./021-multi-scope-targeting-and-tenancy.md) (tenancy anchors,
  org-exclusive rule - absorbed into the registry), [ADR-045](./045-domain-errors-handled-boundary.md)
  (`PermissionDeniedError` as a `HandledError`), ADR-039 sharing redesign (PR #5809).
- Spec: `specs/rbac/unified-authorization-engine.feature` (this ADR);
  supersedes the override scenarios in `specs/rbac/scoped-role-bindings.feature`.
- Evidence: `dev/docs/security/hono-api-rbac-audit.md` (PR #4283); issues
  #1247, #3388, #3429, #3685, #4008; `git log --since=2026-01-01 --
  langwatch/src/server/api/rbac.ts` (28 commits).
