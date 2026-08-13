# Plan: replace `/api/webhooks/v1` with an RPC-named family on `@langwatch/api`

**Branch:** `worktree-webhooks-rpc-plan`
**Status:** IMPLEMENTED — [PR #6949](https://github.com/langwatch/langwatch/pull/6949), ADR-094
**Verified against:** `origin/main` @ `5ad9b57f89`, 2026-08-13

> ## What the build changed about this plan
>
> Kept as written; these are the corrections worth carrying forward.
>
> **Two silent-failure traps the plan did not predict.**
> 1. `hono-openapi` treats ANY dotted path as a static file and drops it, so the
>    family generated **zero** OpenAPI paths with nothing thrown. Needs
>    `excludeStaticFile: false` per family (`[[...route]]/openapi.ts`).
> 2. `guard()` returns the policy *and* its enforcement chain, so
>    `{ ...guard(p), middleware: [mine] }` disarms RBAC and the plan gate while
>    the registry still reports the route guarded. `guard(permission, extra)`
>    now makes composition the only spelling.
>
> **Three plan claims that were wrong.**
> - *"Webhooks is the first family that needs extra middleware."* It is not —
>   `withIdempotency` is a wrapper, not middleware, so it stayed in the handler.
>   The `guard` hardening landed anyway, as a latent trap.
> - *"The per-request `Error("ClickHouse is not configured")` is a defect to
>   fix."* It is correct as-is: CLAUDE.md says an infra failure the caller
>   cannot act on stays a plain `Error`.
> - *"Re-point the two `roll-secret` / `test` exemptions."* They had to be
>   **deleted** — both now take a body — and two new ones added for the
>   genuinely argument-free `endpoints.list` and `eventTypes.list`.
>
> **The gate needed more care than "use the factory".** Webhooks admits on the
> `webhookEndpointsEnabled` FLAG, not the Enterprise tier; `requireEnterprisePlanRest`
> gained an `entitlement` option so the 402 did not silently start refusing every
> Pro or Custom contract that bought the feature.
>
> **A contract regression the plan missed.** Six mistakes answer
> `webhook_endpoint_invalid`, and the framework publishes the code as the
> message — so *which rule you broke* had to move to `meta.reason` + `tips`.
>
> **Consumers were bigger than estimated.** Regenerating the Python client
> rewrites ~940 files of pre-existing drift; it is its own commit so review can
> skip it, since `models/__init__.py` indexes every module and a partial apply
> leaves the package broken.

---

## Context

The webhook-endpoints platform ships today as a hand-rolled Hono app at
`/api/webhooks/v1/*` — **815 lines in one file**
(`platform/app/src/app/api/webhooks/[[...route]]/app.ts`), built on the older
`createOrgApp` / `SecuredApp` builder. It predates `@langwatch/api`, the service
framework that four management families — `organization`, `roles`,
`role-bindings`, `scim-tokens` — already run on via `createManagementService`.

Webhooks therefore misses everything that package provides: date-versioned
namespaces with `latest` / `preview` aliases and `X-API-Version` headers,
declarative `input` / `output` / `params` / `query` zod with enforced **output**
validation, the built-in error handler, and the `onRouteMounted` callback that
makes an unclassified route a build failure rather than a review catch.

Three gaps in the current surface that the port closes on its own:

- **Path params are unvalidated.** Every `:id` is read as raw
  `c.req.param("id")` with no zod at all; only the service's existence check
  catches a bad value.
- **Business logic sits in the route.** The PATCH handler decides between
  `update` / `getById` / `disable` / `enable` itself; the deliveries cursor
  codec (`${firedAt.getTime()}~${id}`) is encoded and parsed inline; the
  test-fire path builds its own envelope and calls `sendWebhook` directly.
- **No output validation.** Response DTOs are described for OpenAPI but never
  checked at runtime, so the published spec and the actual bytes can drift.

### Why now

**The cut-over is unusually cheap, and that is the whole reason to do it now.**
`/api/webhooks/v1` has had **zero 2xx responses in production since it shipped**
(2026-08-04 → 2026-08-13). Of 895 requests:

| Count | Status | What |
|---:|---|---|
| 865 | 401 | Unauthenticated — 852 from one `node`-UA scanner burst on 08-08/09 |
| 18 | 404 | A `ZOLTRAAK/0.2.0 (security-research)` scanner probing `/chat/completions` and `/models`, hunting an exposed OpenAI-compatible proxy |
| 12 | 403 | The **only** authenticated attempts — one org, one 7-hour window on 08-11, every one refused by the enterprise plan gate |

There is no installed base to protect. This is the last moment the surface can
be reshaped without a compatibility story.

Re-run before starting, since the window will have moved:

```
{service_name="langwatch-app"} | url =~ `.*/api/webhooks/v1.*`
```

(The path lives in the `url` structured-metadata field; the log line body is
just `request handled`. Org attribution comes from the `organization.id` span
attribute in Tempo, not the log line.)

### Decisions taken

1. **True RPC paths** — dotted method names, all POST. A new convention with no
   precedent in the repo and no support in `@langwatch/api`; it needs an ADR and
   framework work first, and it deliberately diverges from the four
   already-migrated REST families.
2. **Hard replace** — `/api/webhooks/v1/*` is deleted, not aliased. Old paths
   404. SDKs, CLI and docs move in the same change.
3. **Reuse `MANAGEMENT_API_VERSION`** (`2026-08-07`,
   `server/api/management/version.ts:9`) so callers pin one vintage across every
   org-scoped family.

### Still to confirm

**The enterprise gate moves 403 → 402.** See
[the gate section](#the-enterprise-gate-403--402) — this is near-forced by the
factory, but it changes a wire code, so confirm before Slice 4. Everything
upstream of Slice 4 is unaffected either way.

---

## Where things stand

```
  TODAY                                        TARGET
  ─────                                        ──────

  createOrgApp (SecuredApp)                    createManagementService
  server/api/security/                         server/api/management/
        │                                             │
        │                                             ▼
        │                                      createService (@langwatch/api)
        ▼                                             │
  /api/webhooks/v1/endpoints                          ▼
  /api/webhooks/v1/endpoints/:id               /api/webhooks/2026-08-07/endpoints.list  ← pinned
  /api/webhooks/v1/endpoints/:id/roll-secret   /api/webhooks/latest/endpoints.list      ← newest dated
  ...12 routes, 5 HTTP verbs                   /api/webhooks/endpoints.list             ← bare, the documented one
                                               ...12 routes, all POST

  hand-rolled onError                          createErrorHandler (built in)
  raw c.req.param("id"), no zod                zod `input` on every endpoint
  DTOs described, never checked                `output` validated at runtime
  no version headers                           X-API-Version / X-API-Version-Status
  policy via .access(requires(...))            policy via guard(...) + onRouteMounted
  bespoke 403, untyped Error                   402 enterprise_plan_required (HandledError)
```

Enforcement order is fixed by the factory and documented in its header:

```
  request
    │
    ▼
  org API-key auth          → 401 missing_credentials / invalid_credentials
    │                              / organization_not_found
    ▼
  RBAC permission check     → 403 insufficient_permissions
    │
    ▼
  Enterprise plan gate      → 402 enterprise_plan_required
    │
    ▼
  handler
```

"You don't have access" must always beat "your plan doesn't include this", and
both come after authentication — which is also what the plan gate needs, since
it reads the organization off the context.

---

## Verified against `origin/main`

An earlier pass at this plan was written from a checkout **139 commits behind**
origin, where `packages/api` has no consumers, no `onRouteMounted`, and no
`createManagementService`. Every claim below was re-checked against real files
in a worktree off `origin/main`.

| Claim | Where |
|---|---|
| `onRouteMounted` fires per mounted route, carrying opaque `meta` | `packages/api/README.md:98,133,172`; `src/__tests__/route-mounting.unit.test.ts:45` |
| `createManagementService` + `guard()`, 4 families on it | `server/api/management/managed-service.ts:69–96` |
| `MANAGEMENT_API_VERSION = "2026-08-07"` | `server/api/management/version.ts:9` |
| `v.sse` is the pseudo-method precedent; no `rpc` yet | `packages/api/src/version-builder.ts:70` |
| `assertEndpointPath` passes dotted names | `version-builder.ts:116` — rejects only `latest`, `preview`, date-shaped first segments |
| `EndpointConfig` has `docs` (summary/tags/operationId) and `meta` | `packages/api/src/types.ts:114,123` |
| Route-table parser special-cases `sse` in 4 spots | `scripts/lib/hono-route-table.ts:129,143,146,185` |
| `GATED_PREFIXES` read in 5 places, one by equality | `check-openapi-completeness.ts:85,205,242,432,512` |
| `APP_DERIVED_PREFIXES` already lists `/api/webhooks` | `tasks/generateOpenAPISpec.ts:53` — **no change needed** |
| 3-file family split is the real convention | `app/api/organization/[[...route]]/{app,handlers,wire}.ts` |

Current sizes, measured rather than remembered: `app.ts` **815** lines,
integration test **747** lines, spec **56** scenarios, TS SDK **13** hardcoded
paths, Python SDK **12**, CLI **10** files, `docs/api-reference/webhooks/`
**13** pages, **20** files under `docs/` mentioning `webhooks/v1`.

---

## Design: RPC support in `@langwatch/api`

The framework already has the exact precedent needed. `v.sse(path, ...)` is a
pseudo-method that mounts as a real GET, and both the pipeline and the
route-coverage parser special-case it. `v.rpc` follows that groove.

### `v.rpc(path, config, handler)` → mounts as POST

In `packages/api/src/version-builder.ts`, alongside `sse`:

```ts
/** Register an RPC-named endpoint. Mounts as POST; the name carries the verb. */
rpc<TConfig extends EndpointConfig>(
  path: string,
  config: TConfig,
  handler: Handler<TApp, TConfig>,
): void {
  assertRpcPath(path);          // new: shape of the dotted name
  this._register("post", path, config, handler);
}
```

`assertEndpointPath` needs **no change** — `/endpoints.create` has a first
segment of `endpoints.create`, which is neither `latest`, `preview`, nor
date-shaped, so the reserved-namespace check already passes it. Hono routes a
dotted segment as a plain literal.

Add `assertRpcPath` to pin the convention at registration time rather than in
review:

```
^/[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$    →  /endpoints.rollSecret   ✓
                                                 /endpoints/:id          ✗
                                                 /endpoints.Roll_Secret  ✗
```

Endpoint identity for forward-copying is `` `${method}:${path}` `` and needs no
change — `post:/endpoints.create` is already unique. `v.withdraw("post",
"/endpoints.create")` works unmodified.

### Three traps to design around

**1. The `guard()` middleware collision — the one that bites this port.**

`guard(permission)` returns *both* halves of the contract:

```ts
const guard = (permission: Permission) => ({
  meta: { policy: requires(permission) },
  middleware: [
    requireOrgPermissionOrThrow(permission),
    requireEnterprisePlanRest(feature),
  ],
});
```

None of the four migrated families passes extra middleware — `grep -rn
"middleware:"` across all four returns nothing. **Webhooks is the first family
that needs some**, because `endpoints.create` carries `withIdempotency`. The
obvious spelling silently disarms the guard:

```ts
// WRONG — the later `middleware` key replaces guard's array entirely.
// RBAC and the plan gate are gone. Nothing catches it.
v.rpc("/endpoints.create", { ...guard("webhookEndpoints:manage"),
                             middleware: [idempotency] }, handler)
```

Nothing catches it because the two things that could, don't:
`api-endpoint-authorization.integration.test.ts` compares the router's routes
against the *declared policy registry*, and `meta.policy` is still perfectly
present — the registry says the route requires `webhookEndpoints:manage` while
the chain no longer enforces it. `managed-service.unit.test.ts` covers
"guard declared" and "no guard at all", not "guard declared, middleware
overwritten". The result is an endpoint that authenticates, then accepts anyone.

Compose, never replace:

```ts
const manage = guard("webhookEndpoints:manage");
v.rpc("/endpoints.create",
      { ...manage, middleware: [...manage.middleware, idempotency] },
      handler)
```

**Better: close it in the factory** rather than relying on every future author
spelling it right. Give `guard` a second parameter and make composition the only
available spelling:

```ts
const guard = (permission: Permission, extra: MiddlewareHandler[] = []) => ({
  meta: { policy: requires(permission) },
  middleware: [
    requireOrgPermissionOrThrow(permission),
    requireEnterprisePlanRest(feature),
    ...extra,
  ],
});
```

Add a `managed-service.unit.test.ts` case that asserts the RBAC and plan-gate
middleware survive when an endpoint supplies its own. This is a small change
that removes a whole class of silent authorization bypass, and it is worth doing
in Slice 2 whether or not the rest of the RPC work proceeds.

**2. Zero-argument RPCs.** `eventTypes.list` and `endpoints.list` take no
arguments, but every RPC is a POST, and Hono's `zValidator("json", ...)` rejects
an absent body. The pipeline only appends a json validator when `input` is
declared, so omitting `input` is safe — a client sending `{}` and a client
sending nothing both work. **Rule for the ADR: an RPC with no required arguments
declares no `input`, and the handler ignores the body.** Do not write
`input: z.object({}).optional()`; that reintroduces the parse.

**3. Reads become POST.** Nothing today caches these responses and the surface
is org-API-key only, so there is no practical loss — but state it in the ADR,
because it forecloses HTTP-level caching and makes every read non-idempotent by
HTTP semantics. Idempotency stays explicit: only `endpoints.create` carries
`withIdempotency`, and its operation key moves from
`"webhooks.v1.endpoints.create"` to `"webhooks.endpoints.create"` — safe to
change, since the dedup window has never had a hit.

### Coverage gate

`platform/app/scripts/lib/hono-route-table.ts` parses source text with

```ts
`\\.(${[...HTTP_METHODS, "sse"].join("|")})\\(\\s*"(/[^"]*)"`
```

and maps `sse → get` (lines 129, 143). Add `"rpc"` to that alternation and map
`rpc → post`, mirroring the existing `sse` touch-points (129, 143, 146, 185).
**Without this, every RPC route is invisible to `check:openapi-route-coverage`
and the ratchet reports green while publishing nothing.**

`scripts/check-openapi-completeness.ts:85` has
`GATED_PREFIXES = ["/api/gateway/v1", "/api/webhooks/v1"]` plus per-operation
exemptions for `roll-secret` and `test`. Change the prefix to `/api/webhooks`
and re-point the exemptions. **Not a one-liner:** the constant is read at 205,
242, 432 and 512, and **line 242 compares a value against the list by equality**
(`GATED_PREFIXES.includes(value)`), not by prefix — check that path when the
value changes.

---

## Endpoint mapping — all 12

Route list confirmed against `app.ts` lines 341–789.

| Today | RPC name | `operationId` | Permission |
|---|---|---|---|
| `POST /endpoints` | `POST /endpoints.create` | `createWebhookEndpoint` | manage |
| `GET /endpoints` | `POST /endpoints.list` | `listWebhookEndpoints` | view |
| `GET /endpoints/:id` | `POST /endpoints.get` | `getWebhookEndpoint` | view |
| `PATCH /endpoints/:id` | `POST /endpoints.update` | `updateWebhookEndpoint` | manage |
| `DELETE /endpoints/:id` | `POST /endpoints.archive` | `archiveWebhookEndpoint` | manage |
| `POST /endpoints/:id/roll-secret` | `POST /endpoints.rollSecret` | `rollWebhookEndpointSecret` | manage |
| `POST /endpoints/:id/test` | `POST /endpoints.test` | `sendWebhookEndpointTest` | manage |
| `GET /endpoints/:id/deliveries` | `POST /endpoints.listDeliveries` | `listWebhookEndpointDeliveries` | view |
| `GET /endpoints/:id/health` | `POST /endpoints.getHealth` | `getWebhookEndpointHealth` | view |
| `GET /event-types` | `POST /eventTypes.list` | `listWebhookEventTypes` | view |
| `GET /events` | `POST /events.list` | `listWebhookEvents` | view |
| `GET /events/:id` | `POST /events.get` | `getWebhookEvent` | view |

Every `:id` path param and every query parameter folds into the `input` schema —
which is the change that finally validates them. `operationId` stays explicit
(the package's own doc comment: *"generated ids leak URL shapes into SDK
function names"*), and it drives both SDKs' method names.

---

## Work breakdown

Strictly ordered — the ADR and the framework gate everything downstream.

### Slice 1 — ADR (blocking)

`dev/docs/adr/0XX-rpc-endpoint-naming.md`. **Do not pick the number from `main`
alone** — ADR numbers collide across branches; check open PRs first. The PR body
needs a `## Deployment Impact` H2 or the ADR gate fails.

It must answer, explicitly:

- **Why RPC naming, given four families just shipped as resource-REST.** Is
  webhooks a **pilot** the others follow, or a permanent two-convention split?
  *Recommendation: declare it a pilot with a review date, and say plainly that
  two conventions coexisting indefinitely is the failure mode to avoid.*
- The `<resource>.<verb>` camelCase grammar and the zero-argument rule.
- All-POST, and what that forecloses.
- Relationship to **ADR-088** (Terraform provider), the stated acceptance
  authority for management APIs — *"could a Terraform provider be built on this
  without contortions?"*. RPC paths do not break that, but say so rather than
  leave it inferred.

### Slice 2 — framework

- `packages/api/src/version-builder.ts` — `rpc()` + `assertRpcPath`
- `packages/api/src/index.ts` — no new export needed (`rpc` is a builder method)
- `packages/api/src/__tests__/{route-mounting,builder}.unit.test.ts` — mounting
  across dated / `latest` / bare, forward-copy inheritance, `withdraw` of an
  RPC, rejection of a bad name
- `packages/api/README.md` — the RPC section
- `platform/app/scripts/lib/hono-route-table.ts` — `rpc → post`
- `server/api/management/managed-service.ts` — `guard(permission, extra)`, plus
  the unit test that the guard middleware survives extra middleware

Run: `pnpm --filter @langwatch/api test:unit`

### Slice 3 — spec first

`specs/webhooks/webhook-endpoints.feature` — **56 scenarios**, most naming a
path. Rewrite before touching implementation.

**Every scenario needs a binding tag** (`@unit` / `@integration` / `@e2e` /
`@regression`) **and** a matching `@scenario "<title>"` annotation on the test.
An untagged `.feature` reports `0/0 scenarios bound` / `✓ all bound` and
enforces nothing at all. Where two tests carry the same `@scenario`, only the
last one binds.

### Slice 4 — the family

Replace `platform/app/src/app/api/webhooks/[[...route]]/app.ts` entirely. At 12
endpoints it earns the three-file split the `organization` family uses:

```
platform/app/src/app/api/webhooks/[[...route]]/
  app.ts        service creation + endpoint registration only
  wire.ts       zod schemas, WebhooksFamilyApp type, row→wire mappers,
                the deliveries cursor codec (moved out of the route)
  handlers.ts   the handler functions
```

```ts
const { service, guard } = createManagementService({
  name: "webhooks",
  basePath: "/api/webhooks",   // spelled literally — the coverage parser reads source text
  feature: "WEBHOOKS",         // new key, see the gate section
});

export const app = service
  .provide({
    endpoints: () => new WebhookEndpointService({ prisma }),
    health:    () => new WebhookHealthService({ /* ... */ }),
    events:    () => /* WebhookEventsService from getApp().gateway.webhookEvents */,
  })
  .version(MANAGEMENT_API_VERSION, (v) => {
    registerEndpointEndpoints(v);
    registerEventEndpoints(v);
  })
  .build();
```

Reuse, do not reimplement: `WebhookEndpointService`, `WebhookHealthService`,
`WebhookEventsService`, `WEBHOOK_EVENT_TYPES` (`ee/webhooks/eventRegistry.ts`),
`toWireEnum` / `toStoredEnum`, `withIdempotency`, `emitManagementAudit`.

**Push the four inline-logic sites into the service layer** while porting — the
PATCH status transition, the cursor codec, the test-fire envelope build, and the
per-request `WebhookEventsService` construction, which currently throws a plain
`Error("ClickHouse is not configured")` and degrades to a generic 500.

#### The enterprise gate: 403 → 402

Today `requireWebhookPlan` → `assertWebhookEndpointsEntitled` → **403**, and
`WebhookEndpointsNotEntitledError extends Error` (not `HandledError`), with each
transport wrapping it by hand.

**Reading the factory makes this much less of a free choice than it looks.**
`createManagementService({ name, basePath, feature })` takes `feature:
EnterpriseFeature` as a **required** parameter, and the `guard()` it returns
*always* composes `requireEnterprisePlanRest(feature)`. There is no variant that
authenticates and authorizes without also gating on a plan. So:

- **Use `createManagementService` → 402, by construction.** Keeping the bespoke
  403 means dropping to raw `createService` and hand-wiring auth, RBAC, the plan
  gate *and* the policy registration — forfeiting most of the reason to migrate.
- **Add a `WEBHOOKS` key to `ENTERPRISE_FEATURE_ERRORS`**
  (`server/api/enterprise.ts:13`). There is no webhooks key today; the nine are
  `RBAC`, `AUDIT_LOGS`, `SCIM`, `ANOMALY_RULES`, `ACTIVITY_MONITOR`,
  `INGESTION_SOURCES`, `OCSF_EXPORT`, `MANAGEMENT_API`, `GROUPS`. **Do not reuse
  `MANAGEMENT_API`** — its copy names the wrong feature. The
  `webhookEndpointsEnabled` flag is shared with spend reconciliation, so keep
  the flag and add the key beside it.

This changes the wire response for the single org that has ever authenticated
here, from a bare 403 to a 402 that says how to fix it. Given the zero-adoption
evidence, it is the cheapest such change it will ever be.

A second, independent force points the same way: the authorization guard test
excludes only `ALL` + wildcard mounts, so the version-namespace guard
`app.all("/:apiVersion{latest|preview|20\d{2}-...}")` is a **concrete-path `ALL`
route the guard demands a policy for**. `createManagementService` already
registers it as a reasoned public endpoint (`managed-service.ts:104–126`).
Hand-rolling on raw `createService` means rediscovering that the hard way.

Any new error code goes in `platform/app/src/features/errors/logic/codes.ts`
(sorted) **and** `presentation.ts` in the same change — the registry is
exhaustive over enumerated codes, so a miss fails `pnpm typecheck`, and a code
not yet listed is caught by `codes.unit.test.ts`.

### Slice 5 — mount and publish (three places, and only the first fails loudly)

1. `platform/app/src/server/api-router.ts` — replace the `webhookPlatformApp`
   import and its `api.route("/", ...)`. **Miss this and the family 404s with no
   compile error and no test failure.** Respect the file's
   `// ORDERING: specific paths before catch-all siblings` rule.
2. `platform/app/src/tasks/generateOpenAPISpec.ts` — import, `generateSpecs`,
   and the `deepmerge.all([...])` array. `APP_DERIVED_PREFIXES` already lists
   `"/api/webhooks"` (line 53), so the stale-path prune needs no change.
3. `docs/scripts/generate-api-reference-pages.ts` — or the operations sit in the
   JSON with no reader-findable page.

`specs/api-reference/openapi-route-coverage.feature` documents this exact
three-step failure and why the gate exists.

### Slice 6 — consumers (same PR, per the hard-replace decision)

- **TS SDK** — `sdks/typescript/src/client-sdk/services/webhooks/webhooks-api.service.ts`
  (13 hardcoded path references); regenerate
  `sdks/typescript/src/internal/generated/openapi/api-client.ts`
- **TS CLI** — `sdks/typescript/src/cli/commands/webhooks/*.ts` (10 files).
  Paths live in the service, so these should need little or no change; verify
  the boot-graph test still passes
  (`src/cli/__tests__/index-boot.unit.test.ts` — lazy `import()` is load-bearing
  there and is the one place the inline-import ban does not apply).
- **Python SDK** — `sdks/python/src/langwatch/webhooks.py` (12 paths); regenerate
  the modules under `generated/langwatch_rest_api_client/api/webhooks/`
- **Signature verification is untouched** — `verify-signature.ts`,
  `webhook_signature.py` and `specs/webhooks/signature-vectors.json` concern the
  *outbound* delivery envelope, not the management API. Do not disturb them.
- **Docs** — 13 pages under `docs/api-reference/webhooks/` bind paths verbatim
  (`openapi: "GET /api/webhooks/v1/endpoints"`) with no indirection; 20 files
  under `docs/` mention `webhooks/v1` in total, including
  `docs/features/webhooks.mdx` (route table + curl),
  `docs/ai-gateway/api/management.mdx`, `api/errors.mdx`, `rbac.mdx`,
  `cookbooks/metering-and-rebilling.mdx`, and the `docs/docs.json` nav group.
  An orphan Mintlify page is still a live page — check the nav, not just the files.
- **`feature-map.json`** — the `ai-gateway.webhooks` `"api"` field. While there,
  fix two stale entries: `sdk.python` and `sdk.typescript` are `null` although
  both SDKs ship full facades, and `surfaces.docs` is `null` although the doc
  pages exist.
- **The tRPC sibling is unaffected** — `server/api/routers/webhookEndpoints.ts`
  serves the settings UI over session auth against the same services. It does
  not call the REST surface. **Leave it alone.**

### Slice 7 — tests

- Rewrite `platform/app/src/app/api/webhooks/__tests__/webhooks-rest-api.integration.test.ts`
  (747 lines). The **error envelope changes shape**: the package's `formatError`
  sets `message` to the *code*, never `err.message`, and emits
  `type` / `kind` / `fault` / `tips` / `traceUrl`, with `error` present only on
  unversioned requests. Existing canonical-envelope assertions will fail and
  should be rewritten against `code`, never message prose.
- Add a **router-mount integration test** (the `groups-router-mount` pattern) —
  cheap insurance against the silent-404 trap in Slice 5.
- Add an **enterprise-gate test** for the 402.
- Add the **guard-composition test** from Slice 2 if it did not land there.
- **Version-namespace scenarios** (dated / `latest` / bare / unknown → 404),
  copying `specs/organizations/organization-rest-api.feature`.
- The global backstop
  `server/api/security/__tests__/api-endpoint-authorization.integration.test.ts`
  should pass untouched if `guard()` is spread into every endpoint config.

---

## Risks

| Risk | Mitigation |
|---|---|
| **Guard middleware silently overwritten**, leaving an authenticated-but-unauthorized endpoint | `guard(permission, extra)` in Slice 2 makes composition the only spelling, plus a unit test that the RBAC + plan-gate middleware survive |
| Two API conventions coexist indefinitely | ADR declares webhooks a pilot with an explicit review date and a decision on whether the four REST families follow |
| A private/unreleased caller breaks silently | Accepted — 0 × 2xx over 9 days is the evidence. Re-run the Loki check at implementation time |
| RPC routes invisible to the coverage ratchet | `hono-route-table.ts` change lands in Slice 2, before any RPC endpoint exists |
| Silent 404 from a missed router mount | Router-mount integration test in Slice 7 |
| Error-envelope drift breaks SDK error handling | Both SDKs assert on `code`; verify no SDK reads `message` as prose |
| Spec reads green while binding nothing | Every scenario tagged **and** `@scenario`-annotated; confirm with `check-feature-parity.ts` |

---

## Verification

```bash
pnpm install                               # repo root only (ADR-076)
pnpm --filter @langwatch/api test:unit
pnpm test:integration platform/app/src/app/api/webhooks/__tests__/ --watch=false
pnpm test:integration platform/app/src/server/api/security/__tests__/ --watch=false
pnpm run task generateOpenAPISpec
pnpm check:openapi-route-coverage
pnpm check:openapi-completeness
pnpm typecheck:all                         # typecheck alone never reads test files
pnpm lint                                  # biome, before push
```

Then by hand, against a running stack:

1. `POST /api/webhooks/endpoints.create` → 201, secret present exactly once.
2. Re-POST with the same `Idempotency-Key` → the same body, no second row.
3. `POST /api/webhooks/2026-08-07/endpoints.list` → 200 with
   `X-API-Version: 2026-08-07` and `X-API-Version-Status: stable`; the bare path
   returns `X-API-Version-Status: unversioned` and no `X-API-Version`.
4. `POST /api/webhooks/2020-01-01/endpoints.list` → 404 from the namespace guard.
5. Malformed `input` → 422 `validation_error` with `reasons[].meta.field`.
6. `POST /api/webhooks/v1/endpoints` → **404** (the hard replace).
7. An org without the entitlement → **402** `enterprise_plan_required`.
8. A credential missing `webhookEndpoints:manage` on a lapsed plan → **403**
   before the 402 (order matters).
9. `POST /api/webhooks/endpoints.test` → **200 even when delivery fails**; the
   verdict is `data.delivered`, not the status code. **Preserve this contract.**

Regenerate both SDKs and run their suites; confirm the 13 Mintlify pages resolve
against the new spec.
