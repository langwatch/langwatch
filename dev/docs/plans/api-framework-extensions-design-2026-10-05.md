# API framework extensions E1-E9: proposed shapes

Date: 2026-10-05. Branch: feat/strict-feature-layout-v0. Status: proposal for Alex to approve or change, one
extension at a time. Nothing is built.
Ruling: `.claude/coordinator/rulings-2026-10-05.md` ("shapes first ... Alex approves before any is built"; drift
rules opt in to a justified disable). Inventory: `dev/docs/plans/api-framework-bypass-2026-10-05.md`. Record §8,
§12; CLAUDE.md rule 6.

## How to read this

- Pipeline stages are those of `routeStack` in `packages/api/src/rest/runtime.ts:525-560`: **S1** the door
  (`authenticateMiddleware`, `:589`) and credential facts; **S2** body cap and raw body; **S3** validators and the
  merged input (`:750`, `:862`); **S4** `handlerMiddleware` (`:951`): decide, `mintsCredential`,
  `checkRouteScope` (`:1521`), `checkEntitlement` (`:1184`), count, idempotency, facts, handler. tRPC runs
  `authorized` then `mintsCredential` then entitlement (`packages/api/src/trpc/runtime.ts:1219-1245`).
- Every extension makes the framework express the check so the handler decides nothing. Where a check depends
  on a loaded row it stays in the application (CLAUDE.md rule 6, last sentence) and is named as such.
- Guard rule ids below are **proposed names** for the lint lane; none exists today. "Disable" means the ruling's
  justified disable (a reason is required; a bare disable is an error). Only the API-middleware rule and the
  open-access rule accept one, per the ruling.

---

## E1. `withInput` takes arrays (and proves it takes intersected unions)

**Problem.** Two routes parse JSON by hand because the body is not a plain object:
`modules/langy/process/src/transport/langy-local.rest.ts:39-49,52-60` (`parseJsonBody`) and
`modules/experiment/process/src/transport/experiment-dspy-steps.rest.ts:26-40,104` (a bare array,
`dSPyLogStepsBodySchema = z.array(...)`).

**Finding first.** `SourceSchema` (`packages/api/src/rest/declaration.ts:76-77`) already admits
`ZodObject.and(ZodDiscriminatedUnion)`, which is exactly langy's `langyLocalConversationBodySchema.and(localToolCallSchema)`.
The comment at `langy-local.rest.ts:52-54` may be stale. Step one of the build is a type test proving the langy schema
passes `withInput`; if it does, langy needs no framework change. Arrays are the real gap: `mergeInput`
(`runtime.ts:884-919`) flattens path, query and body into one object and refuses anything else.

**Shape.**

```ts
withInput<Item extends z.ZodType, const Field extends string>(
  schema: z.ZodArray<Item>,
  options: Readonly<{ as: Field }>,
): RouteBuilder<Api, With<S, { body: RestArrayBody<Field, Item> }>>; // handler: input[Field]: z.output<Item>[]
```

The array is validated as sent and handed under `input[as]`; `DistinctSchema` checks `as` against path and query
names. The document publishes the array as the request body, not the wrapper.

**Before / after** (dspy):

```ts
.withRawBody("text", { mediaType: "application/json" })            // before
.handle(({ app, raw, scope }) => app.logSteps({ projectId: scope.id, steps: stepsOf(raw) }))
.withInput(dSPyLogStepsBodySchema, { as: "steps" })                 // after
.handle(({ app, input, scope }) => app.logSteps({ projectId: scope.id, steps: input.steps }))
```

The seconds-not-milliseconds check (`:41-45`) becomes a `.superRefine` on the contract schema with the same message.

**Semantics.** S3. Unparseable is 400 `malformed_request`, schema failure 422 `validation_error` (§8, Alex
2026-09-29). An absent body on an array route is the 400 (the "absent is `{}`" rule is for bodiless actions, which
an array route never is). Logged as every validation refusal is.

**Wire.** One change: broken JSON on `/api/dspy/log_steps` answers 422 today (route docs at `:110-122` pin it)
and would answer 400. Question 1.

**Alternatives.** (a) The array _is_ the input when the route has no path or query fields: the handler's input
changes shape the day a query parameter is added. (b) Wrap it in the contract (`{ steps: [...] }`): breaks the SDKs.

**Guard.** `no-hand-parsed-body` (guard 3): `JSON.parse` of `raw` or of an input field in a transport is an error;
`withRawBody` requires `because`. No disable: `because` is itself the justification.

---

## E2. REST permission-all

**Problem.** `modules/workflow/process/src/workflow.module.ts:52-62` binds `workflowEvaluationRunCeiling`, a
fact that reads the credential and asks authz `evaluations:view`; the app refuses on it as its first line
(`app/workflow.app.ts:996`); route at `transport/workflow.rest.ts:155-177`.

**Shape.** The tRPC overload (`trpc/runtime.ts:462-469`) on REST:

```ts
withPermission(
  permissions: readonly [AuthzPermission, AuthzPermission, ...AuthzPermission[]],
  target?: RestPermissionTarget | RestPermissionReach,
): RouteBuilder<Api, With<S, { permission: true }>>;
```

Declaration-time check: `sharedGrantTiers` (`access/access.ts:70`) must be non-empty, as tRPC's
`permissionAllOf` asks. `RestIdentity.authenticate` takes `permissions: readonly AuthzPermission[]`; the door asks
each in declared order and refuses on the first missing one.

**Before / after.**

```ts
.withPermission("workflows:create")                                         // before
.withMiddleware(projectRestFacts, workflowEvaluationRunCeiling)
.handle(async ({ app, input, scope }, project, mayReadRuns) => app.triggerEvaluation({ callerMayReadRuns: mayReadRuns, ... }))
.withPermission(["workflows:create", "evaluations:view"])                   // after
.withMiddleware(projectRestFacts)   // E5 removes this too
.handle(async ({ app, input, scope }, project) => app.triggerEvaluation({ ... }))
```

**Semantics.** S1 for the credential's own scope; S4 `checkRouteScope` for `{ at: "route" }`. The refusal is the
door's existing one, `ApiKeyPermissionDeniedError(permission)` (`modules/auth/process/src/services/api-rest-credentials.service.ts:114`),
the same class and code (`api_key_permission_denied`, 403) the app throws today. A legacy project key passes by
class, as `principalOfCredential` returning `null` does today.

**Wire.** Body and status identical. Ordering moves earlier: a caller lacking `evaluations:view` who also sends an
invalid body gets 403 where today it gets 422. That is §8's rule (authenticated before parsed, Alex 2026-09-30).

**Alternatives.** (a) A second `withPermission` call meaning AND: reads as a replacement. (b) A framework-owned
ceiling fact: still a fact, still invisible to the document.

**Guard.** `no-authorization-in-transport-facts` (the API-middleware rule): a `bindRestMiddleware` resolver that
calls a credential reader or an authz member (`can`, `holds`, `hasPermission`, `hasApiKeyPermission`) is an error.
Opts in to the justified disable.

---

## E3. Permission chosen from the parsed input

**Problem.** The permission depends on a value in the input, so the route declares an escape kind:
`langy-ui-actions.rest.ts:85-99` (`deferredScope`; the catalogue's `requiredPermission` per `kind`,
`services/langy-ui-action-door.service.ts:65-76`); `data-retention.trpc.ts:43-68` (`serviceAuthorized`; permission
by `scope.scopeType`, `services/data-retention-policy.service.ts:52-63`); the tier maps in `model-provider.trpc.ts:75-235`,
`feature-flag.trpc.ts:31-99`, `project.trpc.ts:96`, `data-privacy.trpc.ts:49,61`.

**Shape.** A declared map, never a callback:

```ts
export function permissionBy<const Field extends string, const Map extends PermissionMap>(
  options: Readonly<{ field: Field; map: Map }>,
): InputPermission<Field, Map>;
type PermissionChoice =
  | AuthzPermission
  | Readonly<{ permission: AuthzPermission; tier: DeclaredScopeTier; field: string }>;
// REST and tRPC both accept it:  .withPermission(permissionBy({ ... }))
```

`field` is a dotted path into the parsed input. The map's keys must equal the field's literal union exactly, so a
new scope type is a compile error, not a silent hole. An entry may name the tier and the input field the scope id
is in, when the target is not the procedure's own `via` field.

**Before / after** (data retention):

```ts
.procedure("setForScope").serviceAuthorized(scopeTargeted("..."))                       // before
.procedure("setForScope").withPermission(permissionBy({ field: "scope.scopeType", map: { // after
  ORGANIZATION: { permission: "organization:manage", tier: "organization", field: "scope.scopeId" },
  TEAM: { permission: "team:manage", tier: "team", field: "scope.scopeId" },
  PROJECT: { permission: "project:update", tier: "project", field: "scope.scopeId" } } }))
```

**Semantics.** REST: the third step of §8 ("authorisation that reads the parsed input", after S3), in S4 where
`checkRouteScope` runs; S1 only identifies. tRPC: in `authorized`, before `mintsCredential` and entitlement.
Refusal: the door's `authorize` and `assertRouteScopePermission` (`access/access.ts:231`), 403
`permission_denied` naming the chosen permission, with authz's `explain` meta (§12). A value outside the map
never arrives: the schema refused it 422.

**Wire.** Data retention, model provider, feature flag, project: none intended. Langy ui-actions changes order:
today dark 404, then unknown kind, then the 403 ceiling; after, the 403 comes first and an unknown kind becomes a
422 once `kind` is an enum in the contract (question 4). Scenario voice finish: `scenarios:create` is declared;
the conditional `evaluations:manage` comes from the verified session token, a loaded row, so it stays in the app.

**Alternatives.** (a) `(input) => AuthzPermission`: opaque to the document, the authz sweep and the linter.
(b) One procedure per tier: changes the wire.

**Guard.** The open-access rule `declared-route-access` (guard 4) flags `serviceAuthorized`, `deferredScope`,
`anyAuthenticated`, `noPermission`. Opts in to the justified disable for the row-dependent cases.

---

## E4. Platform-tier target `{ at: "platform" }`

**Problem.** `/api/admin/*` (`modules/ops/process/src/transport/admin.rest.ts:35-58`) is a `publicRoute` with the
`adminActor` fact (`packages/process/src/transport/api-surface.ts:229-234`) throwing `AdminSurfaceHiddenError`;
102 `admitOperator` calls follow `.withFacts(opsOperatorFact).serviceAuthorized(OPS_VIEW)` in ops tRPC; also
`license-registry.trpc.ts:21`, `self-hosted-instance.trpc.ts:18`, identity-lookup, `ops-bug-report.trpc.ts:15`,
and hotel_bot per the ruling.

**Shape.**

```ts
export type RestPermissionPlatform = Readonly<{ at: "platform"; refusal?: "denied" | "hidden" }>;
withPermission<P extends PlatformTierPermission>(permission: P, target: RestPermissionPlatform): RouteBuilder<...>;
// tRPC
withPermission<P extends PlatformTierPermission>(permission: P, options: RestPermissionPlatform): TrpcRouterImplementation<...>;
```

`PlatformTierPermission` (`packages/authorization/src/scope-tiers.ts:117`) makes `{ at: "platform" }` on a
non-`ops:*` permission a compile error. `RestIdentity` gains `authorizePlatform({ caller, permission })`;
auth's `ApiDoorService` implements it over the `authz` peer it already holds, asking
`can({ principal: { type: "user", id: impersonatorId ?? actor.id }, permission, scope: { type: "platform" } })`,
exactly `AdminAccessService.holds` (`modules/ops/process/src/services/admin-access.service.ts:31-43`) and the
impersonator rule of `ops.app.ts:1450-1465`. The framework gains no ops dependency.

**Before / after.**

```ts
.post("/api/admin/impersonate", "startAdminImpersonation")                    // before
.withAccess(publicRoute({ reason: STAFF_RESOLVED_IN_HANDLER })).withMiddleware(adminActor, adminAuthSession, adminAuditRequest)
.withCredential("browser")                                                     // after
.withPermission("ops:manage", { at: "platform", refusal: "hidden" }).withMiddleware(adminAuthSession, adminAuditRequest)
// tRPC: .withFacts(opsOperatorFact).serviceAuthorized(OPS_VIEW) + admitOperator(...)  ->  .withPermission("ops:view", { at: "platform" })
```

**Semantics.** `hidden`: §8 puts the hidden family's 404 before the credential and the body, so S1 answers a
missing session and a non-holder alike with 404 `not_found` (the code `AdminSurfaceHiddenError` carries), before
the cap. `denied` (default): 401 for no session, 403 `permission_denied` (`OpsOperatorRequiredError`'s code).
tRPC: `NOT_FOUND` or `FORBIDDEN` from `authorized`. The door logs the refusal naming the permission and whether
an impersonator asked; never the address. A destructive second gate names the stronger permission instead.

**Wire.** None intended. Which permission each admin route names must match what the app asks today (to verify
per route). `operatorScope` (lw#3584) answers `{ kind: "none" }` and stays a non-refusing read.
`admitCloudAdmin` also refuses without the cloud-ops capability (`ops.app.ts:1426-1431`): a deployment fact, not
a permission (question 6).

**Alternatives.** (a) A door kind `platform_operator`: a second session door, while the permission's tier already
says platform. (b) Keep the facts and lint them: 102 handler gates remain.

**Guard.** Guard 4's pairing check: a handler that calls `admitOperator`, `admitStaff` or `admitCloudAdmin` and an
operation is an error, no disable. `publicRoute` on `/api/admin/*` is caught by the open-access rule.

---

## E5. Typed key credential handed beside `actor`

**Problem.** 29 `*.module.ts` files bind `withTransportFacts`; 22 read the credential there (gateway 6, api-key 6,
workflow 5, trace, model-provider, dashboard, coding-agent, scim 4 each, ...), e.g.
`modules/api-key/process/src/api-key.module.ts:76-92` and `projectRestFacts` (`api-surface.ts:252-259`).

**Shape.** The precedent is the CLI token door's `session` (§8, Alex 2026-10-01; `declaration.ts:1270`):

```ts
withCredential<NewDoor extends KeyDoor, NewSession extends RouteSession = Missing>(
  credential: NewDoor,
  options?: Readonly<{ session?: NewSession; key?: true }>,
): RouteBuilder<Api, With<S, { door: NewDoor; session: NewSession; key: true }>>;
// handler gains: readonly key: RestCredentialPrincipal   (only where declared; KeyDoor = project | organization | api_key)
```

Option A (recommended): hand the existing `RestCredentialPrincipal` union (`packages/api/src/rest/credential.ts`),
so no new type. Option B: a narrower `{ kind, apiKeyId, ownerUserId }` view, as the inventory proposed. The
second-question principal (`principalOfCredential`, `credential.ts:92`) is derivable from either.

**Before / after** (api-key ingestion):

```ts
bindRestMiddleware(apiKeyIngestionCaller, (context) => {                       // before, in api-key.module.ts
  const credential = projectCredentialOfRequest(context.req.raw); return { principal: principalOfCredential(credential), ... } })
.withCredential("project", { key: true })                                      // after, on the route
.handle(({ app, input, key }) => app.createIngestionKey({ ...input, key }))
```

**Semantics.** Set at S1 by the door, which already records it (`api-door.service.ts:217,235`); handed at the
handler. A door that resolves no key (browser, session_key, internal_secret) cannot declare it: compile error.
Logs carry `apiKeyId` and the kind, never a token.

**Wire.** None.

**Alternatives.** (a) Fields on `Actor`: the actor carries authz vocabulary only (§8, Alex 2026-10-01).
(b) Always hand it: every handler could read key details, and the linter could not see who needs them.

**Guard.** `credential-reader-location` (guard 1): credential readers only in `packages/api`, `packages/process`
and `modules/auth`. Whether it accepts a disable is question 8; the proposal is no.

---

## E6. `withEntitlement` for plan flags

**Problem.** `modules/gateway/process/src/gateway.module.ts:108-124` binds `gatewaySpendBillingPlanGate`, reading
`plan.webhookEndpointsEnabled` and throwing `ForbiddenError`; declared at `transport/gateway-spend.rest.ts:62-65,79`.

**Shape.** Widen the closed union (`access/access.ts:456`) and pass the name to the refusal:

```ts
export type ApiEntitlement = "enterprise" | "webhook_endpoints";
export interface Entitlements {
  holds(input: { entitlement: ApiEntitlement; scope: AuthzDeclaredScopeId }): Promise<boolean>;
  refusal?(input: { entitlement: ApiEntitlement; feature: string | undefined }): Error;
}
```

Each new name is one union member plus one branch in auth's `#planEntitlements` (`api-door.service.ts:155-171`),
which already reads `getActivePlan`. Names are the capability, never billing's plan field.

**Before / after.**

```ts
.withMiddleware(gatewaySpendBillingPlanGate)                       // before (+ the module.ts binding)
.withEntitlement("webhook_endpoints")                              // after
```

**Semantics.** S4 after access at the resolved scope (`runtime.ts:1052`), before count, idempotency and handler;
tRPC likewise. Fail-closed as ADR-072 requires: a lookup that throws refuses rather than answering 500 (to verify
in `decideEntitlement`, `access.ts:476`).

**Wire.** Today the refusal is `ForbiddenError`, 403, with "The billing events API is an enterprise feature; ...".
The framework's default is `EnterprisePlanRequiredError`, 402 `enterprise_plan_required` (`packages/api/src/errors.ts:131`).
To keep the wire, the refusal branches on `entitlement` and returns today's 403 body. Question 9.

**Alternatives.** (a) `plan:${keyof Plan}`: ties the framework to billing's shape. (b) A per-route refusal
callback: puts refusal copy back in transports.

**Guard.** The API-middleware rule (E2): a fact resolver that reads a plan or throws a refusal. Disable allowed.

---

## E7. The door refuses ingestion and Langy session key kinds

**Problem.** `modules/agent/process/src/transport/agent-connect.rest.ts:25-29,48,60`: a public access kind plus
`agentConnectHeaders` (authorization, project id, instance token); the key is resolved in
`services/connected-agent-credential.service.ts:41-66,132-140`, which refuses `key_type_not_allowed`, then
`permission_denied` (`scenarios:manage`), and on a miss `project_required` (with reachable projects) or
`api_key_invalid`.

**Shape.** An allow-list on the door, in E5's kind vocabulary widened by two kinds:

```ts
type KeyKind =
  "api_key" | "access_token" | "legacy_project_key" | "ingestion_key" | "langy_session_key";
withCredential("project", { keyKinds: ["api_key", "access_token", "legacy_project_key"] });
```

An allow-list fails closed when a new kind lands; a refuse-list would admit it.

**Before / after.**

```ts
.withAccess(CONNECT_ACCESS).withMiddleware(agentConnectHeaders)              // before
.handle(({ app, input }, credentials) => app.registerConnectedAgentInstance(input, credentials))
.withCredential("project", { keyKinds: [...] }).withPermission("scenarios:manage")   // after
.withResponse("protocol", { produces: [...], because: "...", refusal: renderConnectRefusal })
.handle(({ app, input, actor, scope }) => app.registerConnectedAgentInstance({ ...input, actor, projectId: scope.id }))
```

**Semantics.** S1, inside `authenticate`, after the key resolves and before the permission (today's order,
`:51-58`). The door throws a framework `KeyKindRefusedError` (`key_type_not_allowed`, 403); the route's protocol
refusal renders it, and the door's 401 and 403, into `AgentRegisterRefusedError`'s bytes, as §8 requires of refusals
raised before the handler. Logged as an access refusal at warn.

**Wire.** None intended, with two risks. (1) `project_required` lists the projects the key reaches (`:68-98`); the
project door does not produce that today. (2) Poll and reply authenticate by `instanceToken`, a minted session,
which §8 gives its own door; not E7's. Question 10.

**Alternatives.** Keep the check in agent: that is the bypass.

**Guard.** `no-auth-header-in-transport` (guard 2) catches `authorization` and project-id fields in a middleware
schema, no disable. The open-access rule catches the public kind, disable allowed.

---

## E8. `{ at: "organization" }` on the CLI token door

**Problem.** `enterprise/modules/governance/process/src/transport/governance-cli.rest.ts:29-32` declares
`anyAuthenticated` on every route; each operation calls `GovernanceCliAccessService.admit`
(`services/governance-cli-access.service.ts:102-139`): plan, then organization permission, then active seat. The
mint route takes a raw body (`:136`).

**Shape.** No new builder method: the CLI token door implements `authenticate({ permission, reach })`, not only
`identify`, so `withPermission(permission)` works there. Its scope is already the organization
(`DOOR_SCOPE_TIER.cli_token`, `declaration.ts:189`), so `{ at: "organization" }` is the default. The door asks
authz for the token's user at the token's organization.

**Before / after.**

```ts
.get("/api/auth/cli/governance/ingestion-keys", "listCliIngestionKeys").withAccess(CLI_DOOR)          // before
.get("/api/auth/cli/governance/ingestion-keys", "listCliIngestionKeys")                               // after
.withPermission("<the permission admit names today>").withEntitlement("enterprise", { feature: "ingestionSources" })
// mint: .withInput(schema).mintsCredential("<permission>") instead of withRawBody + JSON.parse in the app
```

**Semantics.** S1 permission, S4 entitlement, `mintsCredential` before the handler. Refusals: 403
`permission_denied`; the plan refusal is 402 (`EnterprisePlanRequiredError`), and today's body adds
`upgradeUrl` (`:117-121`).

**Wire.** The framework asks access before the plan, deliberately ("a caller who may not do this at all is told
that rather than told to buy something", `trpc/runtime.ts:1235`). Today governance asks the plan first, so a
caller lacking both gets 402 today and 403 after. The 402 body's `upgradeUrl` and per-feature message need the
refusal to carry them. The active-seat check is not a permission. Question 11.

**Alternatives.** (a) `withEntitlement(..., { before: "access" })` to keep the order: a second ordering for one
family. (b) A governance-owned door: the door is bound once, by auth (§8, Alex 2026-10-01).

**Guard.** The open-access rule catches `anyAuthenticated`. Disable allowed, but not needed here once E8 lands.

---

## E9. A body refuses a Content-Type that does not match its declared media type

**Problem.** `modules/trace/process/src/transport/collector.rest.ts:127-133` and
`modules/evaluation/process/src/transport/evaluations-legacy.rest.ts:368-373` check `content-type` by hand and
answer 400 `{"message":"Invalid body, expecting json"}` (bodies pinned by tests). A wider defect: Hono's JSON
validator (hono 4.13.1, `dist/validator/validator.js:13-16`) validates `{}` when the type is not JSON, so every
`withInput` route silently ignores a body sent as, say, `text/plain`.

**Shape.**

```ts
withRawBody(form, options?: Readonly<{ mediaType?: string; refuseOtherMediaTypes?: true }>);
withInput(schema, options?: Readonly<{ refuseOtherMediaTypes?: true }>);   // JSON: Hono's jsonRegex, +json included
```

Option A: opt-in per route (no wire change elsewhere). Option B: on for every raw-body route with a declared
`mediaType` and every `withInput` route, closing the silent `{}` at the cost of a change for any client that
sends the wrong type today. Question 12.

**Before / after** (log_results):

```ts
.withRawBody("text", { mediaType: PRODUCES_JSON })            // before; app checks content-type and parses
.withInput(logResultsSchema, { refuseOtherMediaTypes: true }) // after; protocol refusal renders the pinned body
```

**Semantics.** After the door (§8: a missing credential answers 401 first, Alex 2026-09-30), before the cap and the
raw read: it reads one header, no bytes. Status: 400 `malformed_request` recommended (§8 classes "wrong format" as
malformed; main parity for the two pinned routes); the alternative is 415 with a new registered code, which the
protocol renderer would have to map back to 400 for the pinned bodies. A protocol route renders it through its
declared refusal; a JSON route gets the canonical body. Logged at warn (the reason at `collector.rest.ts:123-126`).

**Wire.** The collector answers 401 before main's content-type 400 (main checked the type first); the record
orders the door first, so this is accepted by §8 unless Alex says otherwise. Matching by `jsonRegex` rather than
today's substring `includes("application/json")` refuses odd types the substring accepted.

**Alternatives.** (a) Leave it to each protocol renderer: the check stays in every transport. (b) 415 everywhere:
see above.

**Guard.** Guard 3 extended: reading `content-type` in a transport or app file is an error, no disable.

---

## Order of build

All nine edit `packages/api/src/rest/declaration.ts` and `runtime.ts`, so one lane builds them in series; E2, E4,
E7 and E8 also change the door contract (`RestIdentity`) that `modules/auth` implements, in the same step.

1. **E5**: the credential vocabulary. E7's kinds extend it.
2. **E2** with **E4**: both widen `RestIdentity` (a permission list; `authorizePlatform`). E4 unblocks hotel_bot.
3. **E3**: the input-reading stage; reuses `checkRouteScope`; independent of 1-2.
4. **E1** and **E9**: independent, small. The collector's move to `withInput` needs E9 on `withInput`.
5. **E6**: independent, small. E8 uses it.
6. **E7** after E5. **E8** after E6.

Each guard ships at error only after the module lanes that need its extension have made the tree clean (bypass
plan, Order 5).

## Open questions for Alex

1. E1: `/api/dspy/log_steps` broken JSON answers 422 today and 400 `malformed_request` under §8. Accept the change,
   and an absent body on an array route as the 400?
2. E1: the array handed as `input[as]` (recommended) or as the whole input?
3. E2: REST permission-all as an array overload of `withPermission`, mirroring tRPC?
4. E3: langy ui-actions answers the dark 404 before the permission today. Accept 403 before 404 on dark projects,
   or declare the rollout on the route so it runs first? And an unknown `kind` as a 422?
5. E3: a declared map (recommended) over a callback?
6. E4: `refusal: "hidden" | "denied"` on `withPermission` (recommended) or a separate door kind? Cloud-ops
   capability: don't mount those routes where it is off, or keep the app check?
7. E5: hand the existing `RestCredentialPrincipal` (recommended) or a new narrower type? Declared per route
   (recommended) or always? `projectRestFacts` also carries the project slug: a scope field, or a separate question?
8. E5: does the credential-reader rule (guard 1) accept a justified disable? Proposal: no.
9. E6: closed capability names (`webhook_endpoints`); gateway spend keeps its 403 body rather than the 402?
10. E7: who answers `project_required` with the reachable projects, the project door or agent? Is the
    instance-token door for poll and reply in scope here?
11. E8: accept permission before plan (402 becomes 403 for a caller lacking both)? Is the active seat a property of
    the CLI token door? How does the 402 carry governance's `upgradeUrl` and per-feature message?
12. E9: opt-in or default (including the `withInput` silent `{}`)? 400 `malformed_request` or 415? `jsonRegex`
    or today's substring match? Confirm 401 before the content-type 400.
