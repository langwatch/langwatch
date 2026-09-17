# Sensitive scope input — census and triage

What this is: the detector §3.6 of `rest-declaration-api-v2.md` asks for, run over
every REST route and tRPC procedure, and the per-site triage of what it found.
Read-only audit; no production file was changed.

**Headline: 0 exploitable, 21 declaration-gap-only, 410 correctly discharged,
out of 431 sites.**

Three inherited authorization defects already exist and are **not** re-reported
here — `.claude/handoffs/astra-alignment-review.md` findings 1, 2 and 3. The
important cross-reference is in §5: this detector does **not** reach any of
them, and neither would §3.6's compile refusal.

---

## 1. What the guard does today, confirmed

`assertNoSensitiveScope` (`packages/api/src/access/access.ts:533-549`) leaks in
the four ways §3.6 names, all reproduced by reading the code:

| # | Leak | Confirmed at |
| --- | --- | --- |
| a | plain `Error`, so a hole is a request-time 500 | `access.ts:546` |
| b | `SCOPE_INPUT_FIELDS = Object.values(SCOPE_TIER_FIELDS)` — three tier fields, no `userId` | `access.ts:269`; `modules/authz/contract/src/vocabulary.ts:55-59` |
| c | `field in input`, exact key match | `access.ts:545` |
| d | runs only on the `no-permission` declaration kind | `access.ts:301-302` |

Two things §3.6 does not say, and they change the sizing:

**(e) `assertNoSensitiveScope` never runs on a REST route at all.** The REST
runtime builds its declaration as `kind: "service-authorized"`
(`packages/api/src/rest/runtime.ts:783-789`), and `decide`'s `service-authorized`
arm returns without calling the guard (`access.ts:304-305`). Leak (d) is
therefore total for REST: all 44 REST sites below are outside the guard. The
guard's real surface is the **56** tRPC procedures that call `.noPermission(...)`
— a second copy of it lives at `packages/api/src/trpc/policy.ts:445-460` over
`SENSITIVE_SCOPE_FIELDS`.

**(f) A REST `withPermission(p)` does not target an input field.** The
permission is enforced by the *door*, against the credential
(`rest/runtime.ts:1269` → `apps/api/src/app-rest/api-rest.credentials.ts:71-92`).
The only declaration-level discharge REST has today is
`withPermission(p, { at: "route", param })`, which routes through
`checkRouteScope` (`rest/runtime.ts:1232-1240`) — used by exactly **3** routes.
What actually keeps most REST projectId input safe is a different, undocumented
guard: `assertInputScope` (`access.ts:507-527`) refuses
`input[credentialTierField] !== caller.scope.id`. It is blind the same three
ways — exact key match, credential's own tier only, and it no-ops entirely when
`caller.scope` is null, which is every `browser`-door route
(`apps/api/src/app-rest/api-rest.host.ts:511`).

tRPC is the opposite: `withPermission(p)` **is** targeted at an input field.
`resolveDeclaredScope` (`modules/authz/contract/src/declaration.ts:185-217`)
picks the **narrowest tier the permission may be granted at that is present in
the input**, so a procedure carrying both `projectId` and `organizationId` under
a project-grantable permission is checked at the project.

---

## 2. The detector

Real AST pass, not regex. `typescript/unstable/sync` + `typescript/unstable/ast`
(ADR-099), following `packages/test-harness/src/ts-ast.ts` — one `API` session,
files staged into a tsconfig-free overlay. The repo's older
`src/test-utils/tsAst.ts` seam named in §3.6 no longer exists in this layout.

Method:

1. Parse all 316 `*.rest.ts` / `*.trpc.ts` / `*.api.ts` transports (tests
   excluded). Working-tree file missing → fall back to `git show HEAD:<path>`;
   one tracked file (`modules/prompt/contract/src/prompt.reasoning.ts`) is
   deleted in this shared checkout.
2. Anchor on `.get|post|put|patch|delete("<path>", "<op>")` for REST and
   `.procedure("<name>")` for tRPC, then walk the fluent chain **upward through
   `node.parent`** collecting `.withParams/.withQuery/.withInput/.withPermission/
   .withAccess/.noPermission/.serviceAuthorized/.handle`, stopping at the next
   anchor.
3. tRPC server transports declare no schema, so each `.procedure(n)` is joined
   to its contract's `.query|mutation|subscription(n).withInput(schema)` through
   the `defineTrpcRouter(Api, <x>Trpc)` argument.
4. Resolve schema expressions structurally: `z.object/looseObject/strictObject`,
   `.extend/.merge/.and/.pick/.omit/.union/.discriminatedUnion/.intersection`,
   and 19 pass-through refinements, recursing through identifiers into a
   14,765-entry index of `const <name> = <expr>`.
5. Normalise every key (`lowercase`, strip `_`/`-`) and keep the ones equal to
   `projectid` / `organizationid` / `teamid` / `userid`. Path `:params` count.

**What it can miss.** Named honestly, because each is a place a real hole could
hide:

- **Identifier collision.** The index is keyed by bare name, not by import
  resolution, so a generic name defined in several packages merges their keys.
  This produced one false positive I confirmed by hand (`scenarioTrpc.getAll`
  `.withInput(projectSchema)` — `projectSchema` resolves in more than one file
  and contributed a spurious `teamId`). It over-reports; it does not under-report.
- **15 of 431 sites** carry at least one schema expression the resolver could
  not open (a helper factory call, a `.parse()` chain). Their key set may be
  incomplete.
- **Routes that declare no schema at all** are invisible: `withRawBody` /
  `withRawResponse` families that parse JSON themselves (`gateway-internal`,
  `workflow-studio` `post_event`, `ops-clickhouse-explain`) can read a tenant id
  out of a body this census never sees.
- **Ids that are not spelled as a scope field** are out of scope by construction
  — `scopeId`+`scopeType`, `apiKeyId`, `virtualKeyId`, a bare `:id`. §5 shows
  why that is the single most consequential limit.
- Handler analysis is textual over the `.handle(...)` callback source; every
  verdict below was then read by hand against the app/service it calls.

Census: **431 sites — 44 REST, 387 tRPC.** Keys: `projectId` 305,
`organizationId` 112, `userId` 27, `teamId` 11, `project_id` 2, `team_id` 2.
Access kinds: `withPermission` 371, `serviceAuthorized` 27, `noPermission` 17,
`withAccess` 9, 7 declaring a permission through a constant.

### Two corrections to §3.6's own numbers

- **"43 snake_case keys in module contracts" is not 43 route-input keys.** The
  four snake_case spellings occur 1,264 times across `modules/` and
  `enterprise/`, but almost all are wire *output* shapes (trace records, gateway
  envelopes). As declared **input** keys on a route or procedure there are
  exactly **four**, on two routes: `project_id` and `team_id` on
  `gateway-spend.rest.ts:552` and `:638`.
- **"3 routes take `:User`" is a miscount.** The only `:User` in a REST path is
  the literal SCIM URN segment
  `/api/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User` — a constant
  path, not a parameter. `:userId` is right: 6 routes.

---

## 3. Triage

### 3.1 EXPLOITABLE — 0

No site in this census lets a caller address another tenant's resource. Every
candidate was traced from the handler to an authorization decision; the ones
that looked worst are in §3.2 and §3.3 with the line that stops them.

This is a statement about *this* census, not about the tree. Three exploitable
authorization defects are already recorded in
`.claude/handoffs/astra-alignment-review.md` findings 1-3. §5 explains why this
detector reaches none of them.

### 3.2 DECLARATION GAP ONLY — 21

The route accepts a caller-supplied scope id that its declaration does not
discharge. Each is unreachable, and the line that makes it so is named. These
are exactly §3.6's "correct today only by convention" class: nothing stops a
later edit from reading `input.projectId` instead of the credential.

| Site | Route | Key | Declared access | Why it is safe |
| --- | --- | --- | --- | --- |
| `modules/analytics/server/src/transport/dashboard-widget.rest.ts:147` | `GET /api/v1/projects/:projectId/analytics/dashboard-widgets` | `projectId` (path) | `withPermission("analytics:view")`, no target | handler reads `projectFor({ app, scope })` at `:168`, never `input.projectId` |
| same file `:172, :204, :230, :264, :295` | POST / GET / PATCH / POST dashboard / DELETE | `projectId` (path) | `analytics:create|view|update|delete`, no target | same `projectFor(... scope)` call in each handler |
| `modules/dashboard/server/src/transport/saved-workbench-chart.rest.ts:108` | `GET /api/v1/projects/:projectId/analytics/charts` | `projectId` (path) | `withPermission("analytics:view")`, no target | `projectFor` returns `input.scope.id` at `saved-workbench-chart.rest.ts:66` |
| same file `:133, :168, :197, :233, :256, :287` | the other six chart routes | `projectId` (path) | `analytics:*`, no target | same, `:127/:157/:191/:221/...` |
| `modules/secret/server/src/transport/secret.rest.ts:67` | `GET /` | `projectId` (query) | `withPermission("secrets:view")` | `app.list({ projectId: scope.id })` at `:77`; the file says so at `:6-8` |
| `modules/secret/server/src/transport/secret.rest.ts:82` | `GET /:id` | `projectId` (query) | `withPermission("secrets:view")` | `app.get({ projectId: scope.id, id })` at `:87` |
| `modules/secret/server/src/transport/secret.rest.ts:130` | `DELETE /:id` | `projectId` (input) | `withPermission("secrets:manage")` | `app.delete({ projectId: scope.id, id })` at `:135` |
| `modules/stored-object/server/src/transport/stored-object.rest.ts:23` | `POST /:uploadToken/confirmation` | `projectId` (input) | `withPermission("project:update")` | handler passes `input` through (`:30`); safe **only** because `assertInputScope` refuses `input.projectId !== caller.scope.id` at `access.ts:518-526`, the project door having set `caller.scope` |
| `modules/stored-object/server/src/transport/stored-object.rest.ts:31` | `GET /:id` | `projectId` (query) | `withPermission("project:view")` | same guard; handler is `app.resolveDelivery(input)` at `:37` |
| `modules/stored-object/server/src/transport/stored-object.rest.ts:39` | `DELETE /:id` | `projectId` (input) | `withPermission("project:manage")` | same guard; handler is `app.delete(input)` at `:45` |
| `modules/project/server/src/transport/project.rest.ts:247` | `GET /:projectId/api-key` | `projectId` (path) | `withAccess(anyAuthenticated(...))` — no permission at all | handler is `async () => refuseBaseKeyToApiToken()` at `:251`; the route refuses unconditionally |
| `modules/project/server/src/transport/project.rest.ts:254` | `POST /:projectId/regenerate-api-key` | `projectId` (path) | `withAccess(anyAuthenticated(...))` | same unconditional refusal at `:259` |
| `modules/authz/server/src/transport/authz-role-binding.rest.ts:96` | `GET /` | `userId` (query) | `withPermission("organization:manage")` | rows come from `organization.organizationId` at `:107`; `input.userId` is only a post-filter at `:109` |
| `modules/workflow/server/src/transport/workflow-studio.rest.ts:103` | `POST /api/workflows/code-completion` | `projectId` (query) | `withAccess({ kind: "public", ... })` | **does not reach runtime**: see §3.4 |

The three `ops-process` procedures that take a `projectId` they never read
(`ops-process.trpc.ts:86, :115, :124`) sit behind `admitOperator` and are
counted under §3.3.

### 3.3 CORRECTLY DISCHARGED — 410

Four shapes, all of which §3.6 already names as a legal discharge:

**(i) tRPC `withPermission` targets the field — 343 sites.** The permission is
resolved at the caller-supplied tier id
(`modules/authz/contract/src/declaration.ts:195-209`), so the input key *is* the
authorization target. This is `atPathScope` in everything but spelling. Includes
every `organizationId`-keyed member/group/role procedure
(`organization.trpc.ts:76, :89, :149, :209`; `group.trpc.ts:43, :63, :67`;
`role-binding.trpc.ts:17, :29, :66`), where the companion `userId` is co-keyed
with the target organization in the same call and the service refuses a
non-member — `organization-group.service.ts:201-204` calls
`teams.getOrganizationMembers({ organizationId, userIds: [userId] })`.

**(ii) The `allow` waiver — 9 + 11 sites.** `.noPermission({ reason, allow })`
already *is* §3.6's `unverified(field).because(reason)`, with the reason
required. `api-key.trpc.ts:23, :30, :37, :44, :61, :72, :83, :90, :97` each
name `allow: { organizationId: "<why>" }`;
`personal-workspace-features.trpc.ts:11-15` and
`enterprise/modules/sso/.../sso-connection.trpc.ts:56-91` do the same through a
shared constant.

**(iii) Honoured deferral — the handler resolves the owner and checks it.**

| Site | What discharges it |
| --- | --- |
| `modules/stored-object/server/src/transport/stored-object-file.rest.ts:150` | the reference deferral; owner authorization at `:200-216` (astra finding 4 confirms) |
| `modules/experiment/server/src/transport/experiment-workbench-run.rest.ts:88` | `permittedPerson({ app, userId: caller.userId, projectId })` at `:100` before any read |
| `modules/experiment/server/src/transport/experiment-workbench-run.rest.ts:195` | `app.abortWorkbenchRun({ ...input, userId: caller.userId })` at `:201` — abort ownership checked in the app |
| `modules/gateway/server/src/transport/virtual-key.trpc.ts:39` and 10 siblings | every handler co-keys `input.organizationId` with `actor.id`; `listVisibleVirtualKeys` intersects against the caller's membership |
| `modules/gateway/server/src/transport/gateway-usage.trpc.ts:29, :48` | same membership intersection before any total is summed |
| `modules/model-provider/server/src/transport/model-provider.trpc.ts:75, :117, :127, :145` | `model-provider-command.service.ts:82` `authorizeWrite(actorId, existing?.scopes, scopes)`; delete authorizes at `:124` |
| `modules/model-provider/server/src/transport/llm-model-cost.trpc.ts:59` | scope derived from the stored row, not the input; `manage` authorized on it |
| `modules/user/server/src/transport/user.trpc.ts:141` | `user.app.ts:801-803` — `userId !== caller.id && !isOperator(...)` throws `UserAccountAccessDeniedError` |
| `modules/user/server/src/transport/user.trpc.ts:149` | `user.app.ts:813-815` — operator only |
| `modules/feature-flag/server/src/transport/feature-flag.trpc.ts:21` | `feature-flag.app.ts:187` `authorizeLooseTarget(input)` |
| `modules/authz/server/src/transport/authz.trpc.ts:22` | answers the caller's own standing; a non-member resolves to the empty set |
| `modules/project/server/src/transport/project.trpc.ts:95` | `createStanding({ app, input, actor })` asks the named team/organization before the write |
| `modules/ops/.../ops-platform.trpc.ts`, `ops-process.trpc.ts` | `app.admitOperator(operator, "ops:view")` first line of every handler |

**(iv) The credential bounds the id in the handler.**

| Site | What discharges it |
| --- | --- |
| `modules/gateway/server/src/transport/gateway-spend.rest.ts:552, :638` | `resolveSpendScope` starts from the credential organization's own projects and **intersects** the supplied ids — `prisma.gateway-spend-scope.repository.ts:86-96`. A foreign `project_id` drops out of the set. |
| `modules/organization/.../organization-management.rest.ts:190, :212, :236, :279` | every `:userId` is passed with `organizationId: scope.id` in the same call (`:201, :226, :268, :287`) |
| `modules/organization/.../team.rest.ts:244, :271` and `group.rest.ts:199, :217` | same co-keying with `scope.id` |
| `modules/project/server/src/transport/project.rest.ts:169` (`teamId`) | `project.service.ts:268-272` `assertTeamCanHoldANewProject({ teamId, organizationId })` |
| `modules/project/server/src/transport/project.rest.ts:209` / `project.trpc.ts:170` (`teamId`) | `project.service.ts:334-343` `findActiveTeamInOrganization` refuses a destination team outside the credential's organization |
| `modules/langy/server/src/transport/langy-internal.rest.ts:79` | the handler cross-checks the `(projectId, conversationId, turnId)` triple at `:94` and 404s a forged one; the door is the deployment's own bearer, which **fails closed** when unconfigured (`api-rest.host.ts:479-481`) |
| `modules/langy/server/src/transport/langy-internal.rest.ts:136` | `revokeWorkerSessionKey({ apiKeyId, projectId })` refuses any key that is not a Langy session key |
| `modules/organization/.../join-request.trpc.ts:40` | `fileJoinRequest({ userId: actor.id, organizationId })` — the offer list is the gate |

### 3.4 One site that is neither: a declaration that cannot load

`modules/workflow/server/src/transport/workflow-studio.rest.ts:103` declares
`withAccess({ kind: "public", ... })` **and** `withQuery(workflowCodeCompletionQuerySchema)`,
which is `z.object({ projectId: z.string().min(1) })`
(`modules/workflow/contract/src/workflow-rest.schemas.ts:129`). `assertRouteReady`
runs inside `.handle(...)` (`packages/api/src/rest/declaration.ts:1126`), and for
a `public` route calls `assertNoScopeInput`
(`declaration.ts:1677` → `:1974-1991`), which reads params **and query** and
throws:

```
REST completeWorkflowCode answers without a credential, so it cannot take "projectId" as input
```

So importing this transport throws at module evaluation. The comment at
`:99-102` says the project is "read off the query rather than declared as one" —
but `assertNoScopeInput` reads the query too. This is the build-time refusal
§3.6 wants, already working, firing on a route that was written believing it
would not. Cross-references astra findings 4 and 5, which record the same file
as importing schemas that were missing at their HEAD; the schema now exists, and
its existence is what makes the route refuse.

---

## 4. What a compile-time §3.6 would have caught

Per finding, which leak it falls through and whether
normalisation + `UnverifiedScopeInput<K>` would have refused it at build time.

| Finding class | Leak it falls through | Refused at build by §3.6? |
| --- | --- | --- |
| dashboard-widget ×6, saved-workbench-chart ×6 (`:projectId`, no target) | (d)/(e) — REST never reaches the guard | **Yes.** `projectId` normalises into the closed set, the declaration names no discharge, `handle` types as `UnverifiedScopeInput<"projectId">`. The fix is one clause: `.atPathScope("projectId")`. |
| secret ×3, stored-object ×3 (`projectId` in query/body) | (d)/(e) | **Yes**, same shape. stored-object is the more valuable catch: its handlers pass `input` straight to the app, so the only thing standing between it and a cross-tenant read is `assertInputScope`, which is itself exact-match and credential-tier-only. |
| `project.rest.ts:247, :254` (`anyAuthenticated` + `:projectId`) | (b) is not it — (d)/(e). `anyAuthenticated` performs **no** permission check and the browser door leaves `caller.scope` null, so `assertInputScope` no-ops too | **Yes**, and this is the one where the type earns its keep: today two routes take a tenant id under an access kind that checks nothing, and only an unconditional `refuseBaseKeyToApiToken()` keeps it honest. |
| `gateway-spend.rest.ts:552, :638` (`project_id`, `team_id`) | (c) — snake_case. Invisible to `assertNoSensitiveScope` **and** to `assertInputScope` **and** to `assertNoScopeInput` | **Yes** — this is precisely what `Normalize<K>` is for. It is also the whole of the snake_case exposure: four keys, two routes. |
| the 6 `:userId` REST routes and 27 `userId` tRPC inputs | (b) — `userId` is not in the set at all | **Yes.** Every one becomes `.matchesCaller("userId")` or `.unverified("userId").because(...)`. `user.trpc.ts:141/:149` is the textbook case: `.noPermission({ reason })` with no `allow`, `userId` straight from the caller, and the entire gate 600 lines away in `user.app.ts:801`. |
| `authz-role-binding.rest.ts:96` (`userId` as filter) | (b) | **Yes**, and the honest discharge is `.unverified("userId").because("filter over rows already bounded to the credential's organization")`. |
| `workflow-studio.rest.ts:103` | none — leak (d) does not apply; the *build-time* check already covers `public` | **Already refused**, at declaration time. Evidence that the §3.6 idiom works; §3.6's contribution is extending it past `public` to every kind. |
| `.noPermission` procedures naming `allow` (20 sites) | none | **No, and correctly so** — `allow` is already the waiver. §3.6 should adopt it rather than replace it: same map, same required reason. |
| astra findings 1, 2 and 3 | **none of the four** | **No.** See §5. |

---

## 5. The limit that matters

The three confirmed exploitable defects in
`.claude/handoffs/astra-alignment-review.md` are **absent from this census**, and
§3.6 would not have refused any of them:

- **Finding 1** (`model-defaults.rest.ts:123, :133, :148, :157`) addresses a
  configuration by opaque `id` and authorizes it with the key **owner's** grants
  instead of the credential's ceiling. No scope key in the input.
- **Finding 2** (`model-defaults.rest.ts:54, :62-68`) declares `project:view`
  and returns organization-wide configuration. No scope key in the input.
- **Finding 3** (`gateway-platform.rest.ts:480-513, :527-535, :683-709, :720-732`)
  derives `organizationId` **from `scope.id`** and queries organization-wide
  under a project-grantable permission. The tenant id is the credential's own —
  there is no caller-supplied key for a normaliser to normalise.

§3.6's closed set is defined over **input spellings**. All three defects are
mismatches between *the tier a permission was checked at* and *the tier the
query reads*. That is a different invariant, and the honest conclusion is:

1. §3.6 is worth building — it converts 21 conventions into declarations and
   closes the `userId` and snake_case blind spots outright. The fact that the
   census found no hole is evidence that the conventions are currently held, not
   that they are enforced.
2. §3.6 is **not** the rule that would have caught the three known holes. A
   second rule is needed, about the *width* of what a handler reads relative to
   the tier its permission was checked at. Sizing that is not this audit's job.
3. The closed set should probably grow by one more pair before it ships:
   `scopeType` + `scopeId`, which `role-binding.trpc.ts:29` and the model-provider
   writes take from the caller and which normalise to nothing in the current set.

## 6. Reproducing

The detector is a throwaway at `/tmp/sscan/` (`parse.mjs`, `scan.mjs`,
`triage.mjs`, `classify.mjs`), run with a symlink to the workspace
`node_modules` so `typescript/unstable/*` resolves. It writes nothing into the
repository. If it is to become the interim
`rest-scope-input-is-discharged` lint named at
`rest-declaration-api-v2.md:866`, the four resolution limits in §2 are the list
of things to fix first, and identifier collision is the only one that changes a
verdict rather than a count.
