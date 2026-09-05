# Security pass — feature API surfaces, 2026-09-04

Read-only audit of every transport under `packages/features/*/server/src/transport/{api-rest,api-trpc,api-ws,api-mcp}` and
`packages/enterprise/features/*/server/src/transport/**`, plus the services and repositories they reach and
`packages/features/*/server/src/repositories/{clickhouse,prisma}/**`.

Branch `feat/strict-feature-layout-v0`. Nothing was modified, staged or run beyond reads and greps.

## Summary

| #      | Sev          | Finding                                                                                                           | Where                                                                    |
| ------ | ------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| C1     | **Critical** | `project:view` mints a full-access legacy project API key through the MCP OAuth flow                              | `apps/api/src/app/api-production.composition.ts:1839`                    |
| H1     | High         | SCIM webhook intake: non-constant-time secret compare, no replay protection, organization chosen from the payload | `enterprise/scim/.../api-rest/scim-webhook-intake.api.ts:49`             |
| H2     | High         | License signing **private key** written verbatim into the audit table                                             | `packages/api/src/trpc/trpc-audit-redaction.ts:44`                       |
| H3     | High         | Every per-IP rate limit on the unauthenticated tRPC surface keys on the literal string `"unknown"`                | `apps/api/src/api.application.ts:602`                                    |
| H4     | High         | Organization REST apps resolve sub-org-tier permissions at **organization** scope (11 routes)                     | `packages/features/project/.../project.api.ts:251,263,344,353`           |
| H5     | High         | MCP access token outlives the grant it was minted from (30 days, no re-check)                                     | `hosted-mcp/.../api-mcp/hosted-mcp.api.ts:66,505`                        |
| H6     | High         | Legacy project key reads any organization's OTTL rules by id                                                      | `enterprise/governance/.../api-rest/governance.api.ts:299`               |
| H7     | High         | Prompt tag assignment writes into the prompt's owning project, not the authorized one                             | `prompt/.../api-rest/prompt.api.ts:455`                                  |
| H8     | High         | Org-wide prompt tag rename/delete gated on one project's permission                                               | `prompt/.../api-trpc/prompt-tag.api.ts:53,72`                            |
| H9     | High         | `workflows:view` escalates to a full workflow run via a legacy-key self-fetch                                     | `workflow/.../api-trpc/workflow-optimization.api.ts:148`                 |
| H10    | High         | `PATCH /api/triggers/:id` mass-assigns `actionParams`, skipping the webhook flag and anti-spoof stamp             | `automation/.../api-rest/automation.api.ts:66,297`                       |
| H11    | High         | Connected-agent instance keys are not tenant-namespaced; `ack`/`result` never check the project                   | `agent/.../adapters/connected-agent-state.adapter.ts:28`                 |
| H12    | High         | Gateway budget/cache-rule REST mutations check at project scope but act organization-wide                         | `gateway/.../api-rest/gateway-platform.api.ts:1443…2010`                 |
| H13    | High         | GitHub installation takeover (installation-id confusion)                                                          | `github/.../api-rest/github.api.ts:248`                                  |
| H14    | High         | A license key carries no organization binding; any valid key activates on any organization                        | `enterprise/licensing/.../services/license.service.ts:139`               |
| M1     | Medium       | `requires()` on a project REST app is not enforced for legacy project keys, and the registry does not say so      | `apps/api/src/api-rest.security.ts:349`                                  |
| M2     | Medium       | Model-defaults REST writes bypass the API-key ceiling (user principal, not key ∩ owner)                           | `model-provider/.../api-rest/model-defaults.routes.ts:101,146,185`       |
| M3     | Medium       | Model-defaults snapshot fails **open** when the credential carries no user                                        | `model-provider/.../services/model-provider-defaults.service.ts:160`     |
| M4     | Medium       | REST provider upsert skips the per-scope write authorization entirely                                             | `model-provider/.../services/model-provider-command.service.ts:238`      |
| M5     | Medium       | Anomaly-rule `destinationConfig` returns the plaintext SIEM `sharedSecret` to any viewer                          | `enterprise/governance/.../api-trpc/anomaly-rules.api.ts:111`            |
| M6     | Medium       | `graphs.getById` bypasses the alert redaction port and returns a Slack webhook URL                                | `dashboard/.../api-trpc/graph.api.ts:247`                                |
| M7     | Medium       | Shared saved views can be deleted or renamed under a read permission                                              | `dashboard/.../api-trpc/saved-view.api.ts:188,228,241,255`               |
| M8     | Medium       | Dataset read materializes the whole dataset; the declared export ceiling is never thrown                          | `dataset/.../adapters/dataset-content.adapter.ts:117`                    |
| M9     | Medium       | Shared-trace per-IP limit and view-dedup key are derived from a spoofable `X-Forwarded-For`                       | `apps/api/src/app/api-trpc-collaborators.trace-group.composition.ts:796` |
| M10    | Medium       | `apiClientAddress` prefers ten client-settable headers over the socket peer                                       | `apps/api/src/app/api-client-address.ts:47`                              |
| M11    | Medium       | Raw `error.message` / `error.stack` reaching 500 response bodies (14 sites)                                       | see F-M11                                                                |
| M12    | Medium       | Internal evaluator-service URL shipped to customers in `HandledError.meta`                                        | `evaluation/.../adapters/http.langevals-evaluator.adapter.ts:103,110`    |
| M13    | Medium       | `ops:manage` enforces nothing that `ops:view` does not                                                            | `apps/api/src/features/ops/ops.composition.ts:395`                       |
| M14    | Medium       | Custom roles have no creator ceiling, and the scope fence lets an org binding grant platform-tier permissions     | `authz/contract/src/registry.ts:337`                                     |
| M15    | Medium       | api-key mint-time ceiling under-approximates built-in role bags                                                   | `api-key/.../services/api-key-grant-policy.service.ts:205`               |
| M16    | Medium       | Governance CLI `status` and `ingestion-templates` declare `permissions: []` and check none                        | `enterprise/governance/.../api-rest/governance-cli.api.ts:825,844`       |
| M17    | Medium       | `routingPolicy.create` persists caller-supplied `scopeId` with no ownership validation                            | `enterprise/governance/.../services/governance-routing.service.ts:53`    |
| M18    | Medium       | `subscription.*` interpolates a bare `baseUrl` into Stripe return URLs — authenticated open redirect              | `enterprise/billing/.../api-trpc/subscription.api.ts:196,221,261`        |
| M19    | Medium       | `POST /api/dataset/generate` is a cookie-authed spend endpoint with no CSRF guard its sibling has                 | `dataset/.../api-rest/dataset-generate.api.ts:85`                        |
| M20    | Medium       | hosted-mcp is 33 route verbs outside the AccessPolicy registry                                                    | `hosted-mcp/.../api-mcp/hosted-mcp.api.ts`                               |
| L1–L20 | Low          | see "Low findings"                                                                                                | —                                                                        |

Latent (defective code on an unmounted surface — fix before re-mount): the Stripe webhook's
missing `payment_status` check, tenant-free `linkStripeId` and absent event de-duplication; the
`/api/ingest/v1/logs` spend-ledger replay; the MCP governance tools' API-key permission skip.

## Coverage

| Family                                                                                                                           | tRPC procedures | REST / MCP / WS routes | Declared check present | Flagged |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------- | ---------------------- | ------- |
| trace, analytics, share                                                                                                          | 60              | 30                     | 90 / 90                | 2       |
| ops, langy, coding-agent, feature-flag, presence, hosted-mcp, stored-object, data-privacy, data-retention                        | 145             | 24                     | 169 / 169              | 9       |
| api-key, auth, authz, user, identity, role, organization, project                                                                | 92              | 96                     | 188 / 188              | 6       |
| gateway, model-provider, secret, entitlement, topic, github                                                                      | 76              | 54                     | 130 / 130              | 16      |
| experiment, evaluation, evaluator, dataset, suite, scenario, workflow, monitor, dashboard, agent, annotation, automation, prompt | 232             | 158                    | 390 / 390              | 39      |
| enterprise (governance, billing, licensing, scim, sso, webhook)                                                                  | 118             | 66                     | 184 / 184              | 26      |
| **Total**                                                                                                                        | **723**         | **428**                | **1151 / 1151**        | **98**  |

- 106 tRPC api files, 757 `.query`/`.mutation`/`.subscription` call sites (the 723 above excludes
  re-exported/mount-only files); 85 REST api files.
- **No procedure and no route in scope was found without a declared access decision.** The tRPC
  builder makes one unskippable at compile time (`packages/api/src/trpc/trpc-permission-builder.ts`),
  and the Hono `SecuredApp` makes one mandatory per route. Every finding below is a check that runs
  but resolves the wrong id, a declaration that claims more than the handler enforces, or a control
  that is inert.
- `packages/enterprise/features/{audit-log,managed-provider,saas}` have **no** transport directory.
- ClickHouse: all 60 repository files swept. Every query carries `TenantId = {tenantId:String}` (or
  `TenantId IN {tenantIds:Array(String)}`) as its **first** predicate, bound as a placeholder. The
  three apparent misses were refuted: `clickhouse.run-configurations.repository.ts` inherits the
  predicate from `ResultAtomsClickHouseRepository.atomScopeSql:497`, and both stored-object files use
  `project_id` as their first predicate. The only `${}`-interpolated SQL fragments expand to module
  constants, a `SELECT` column list built from two module constants, or an
  `Intl.DateTimeFormat`-validated IANA timezone.
- Prisma: **no `$queryRawUnsafe` in any transport-reachable path.** The three `$executeRawUnsafe`
  sites are the ops purge task, the authz migration repository and the LWQL provisioning task —
  tasks and migrations, none reachable from a request, none taking caller input. Every
  `$queryRaw`/`$executeRaw` is a tagged template.
- Egress: no feature package imports `@langwatch/egress` directly except model-provider and the
  enterprise webhook adapters; every other outbound call resolved to a deployment-configured address,
  and the customer-URL paths are fenced one layer out at the composition root.

---

## Findings

### C1 — CRITICAL: `project:view` mints a full-access legacy project API key through the MCP OAuth flow

**Where the check is wrong:** `apps/api/src/app/api-production.composition.ts:1839` — `permission: "project:view"`.

**Traced path**

1. `POST /api/mcp/authorize` gates on `ports.probeProjectPermission`
   (`packages/features/hosted-mcp/server/src/transport/api-rest/mcp-authorize.api.ts:231`), wired at
   `api-production.composition.ts:1832-1840` to `authoringSession.permitted({ …, permission: "project:view" })`.
2. On success the handler stores the project's **legacy** API key in the authorization code:
   `mcp-authorize.api.ts:257` — `encryptedApiKey: ports.encrypt(project.apiKey)`, where `project.apiKey`
   is taken verbatim at `api-production.composition.ts:1827`.
3. `POST /oauth/token` decrypts it and issues a 30-day bearer (`hosted-mcp.api.ts:1180-1204`).
4. Every MCP request then runs under `runWithConfig({ …, apiKey }, fn)` (`hosted-mcp.api.ts:612`).

**Why the grant is not what was checked.** A legacy project key resolves to
`{ type: "legacyProjectKey", project }` with no `apiKeyId`, no `userId` and no bindings
(`packages/features/api-key/contract/src/api-key.tokens.ts:58-70`;
`packages/features/api-key/server/src/services/api-key-token-resolution.service.ts:126-133`). The
REST RBAC middleware then skips every check for it:

```ts
// apps/api/src/api-rest.security.ts:349-354
const resolved = context.get("resolvedToken") as ResolvedApiKeyToken | undefined;
if (!resolved || resolved.type !== "apiKey") {
  return next(); // ← legacy key: no permission is evaluated
}
```

`apiKeyCeiling` is literally `return this.projectAuthorization(...)` (`:387`), so the ceiling does not
apply either. **35 project-scoped REST families** are reachable in full by such a key, including
`gateway-platform.api.ts`'s 24 `apiKeyPermission` routes (virtual keys, budgets, guardrails, providers).

`project:view` is the weakest grant in the product — it is in the `viewer`, `lite-member` and
`demo-viewer` bags (`packages/features/authz/contract/src/roles.ts:22,107,125`).

**Exploit.** A viewer-role member of project `P`, signed in in a browser:

```
POST /oauth/register            {"redirect_uris":["http://127.0.0.1:9999/cb"]}
POST /api/mcp/authorize         {"projectId":"P","redirect_uri":"http://127.0.0.1:9999/cb",
                                 "client_id":"mcp_…","code_challenge":"<S256>",
                                 "code_challenge_method":"S256"}
POST /oauth/token               {"grant_type":"authorization_code","code":"…","code_verifier":"…"}
```

PKCE and the redirect-URI binding are both correctly implemented and defend nobody here — the
attacker authors the request. The returned bearer is the project's full-access key by proxy, valid
30 days, usable from any host with no session. The demo project is explicitly excluded at
`mcp-authorize.api.ts:223`, which shows the authors knew `project:view` is near-universal; a real
project's viewers were not excluded.

**The inconsistency that proves it is a mistake.** Every other disclosure of `project.apiKey` demands
`project:update` or better: `project.api.ts:331` uses `requiresOnProject("project:update")` with a
docblock saying the gate must "match the access it grants", and the CLI device flow uses
`handlerManagedAuth({ permissions: ["project:update"] })` (`auth-cli-device-flow.api.ts:254`).

**Smallest correct fix.** Raise `api-production.composition.ts:1839` to the permission that matches
what the code confers — `project:update`, the same grain `GET /:id/api-key` uses. If MCP is meant to
be viewer-reachable, mint a _scoped_ key bound to the caller's own grants instead of embedding
`project.apiKey`.

### H1 — SCIM webhook intake: weak compare, no replay protection, payload-chosen organization

`packages/enterprise/features/scim/server/src/transport/api-rest/scim-webhook-intake.api.ts:49`

```ts
if (c.req.header("authorization") !== secret)
  return c.json({ error: "Unauthorized" }, { status: 401 });
```

The route declares `internalSecret(...)` but passes no `verifySecret` to `createServiceApp`, so the
framework chain is empty (`packages/api/src/rest/security/rest-api-service.ts:696`) and this line is
the whole gate. Three problems: the compare is not constant-time (every other secret comparison in
the repo uses `crypto.timingSafeEqual` — `github.api.ts:449`, `langy-internal.api.ts:89`,
`ops-clickhouse-explain.api.ts:147`, `organization-provisioning.api.ts:99`,
`packages/egress/src/webhook/signature.ts:75`); there is no signature, timestamp or nonce, so any
captured request replays forever; and the tenant is chosen from the payload —
`emailDomain(email)` → `tryFindOrganizationBySsoDomain({ domain })`
(`api/scim-webhook/scim-webhook.api.ts:56-66`) — then a member is created or deleted in that org
(`:70-91`). The secret is one global deployment value
(`apps/api/src/app/api-scim.composition.ts:215`), so it is authority to provision into _every_
organization with a matching `ssoDomain`. Mounted live at
`apps/api/src/app-rest/app-rest.process-features.ts:798`.

**Exploit.** `POST /api/webhooks/auth0-scim` with the secret and body
`[{"type":"sscim","description":"create","details":{"userName":"attacker@victim-domain.com","body":{"name":{"givenName":"A"}}}}]`
creates a member in the victim's organization; `"description":"delete"` deprovisions one.

**Fix.** `timingSafeEqual` over length-checked buffers at `:49`; verify an HMAC over the raw bytes
with a timestamp tolerance, as `packages/egress/src/webhook/signature.ts` already does. Make the
secret per-connection rather than global so the payload cannot select the tenant.

### H2 — License signing private key written verbatim into the audit table

`packages/api/src/trpc/trpc-audit-redaction.ts:44-47`

`license.generate` takes `privateKey: z.string().min(1)` as a mutation input
(`enterprise/licensing/.../api-trpc/license.api.ts:89-96,188`). Every declared procedure is wrapped
by `auditMutations` (`packages/api/src/trpc/trpc-permission-builder.ts:361`,
`packages/api/src/trpc/trpc-api-service.ts:93`), which records
`args: redactAuditArgs({ input, action: path })` (`trpc-runtime-policy.ts:274`, and `:232` on the
failure path). The scalar redaction registry is exactly:

```ts
const REDACTED_SCALAR_FIELDS_BY_ACTION: Record<string, readonly string[]> = {
  "secrets.create": ["value"],
  "secrets.update": ["value"],
};
```

`license.generate` is absent, and `redactObjectField` ignores plain strings, so the key passes
through untouched. The router is mounted as `license`
(`apps/api/src/app-trpc/app-trpc.features.ts:643`), so the action path matches exactly. That module's
own header calls this rule "the only thing standing between a plaintext secret and a durable,
queryable table". `license.upload`'s `licenseKey` — itself a bearer entitlement, see H14 — has the
same gap.

**Exploit.** Not an attack: an ordinary operator run of `license.generate` deposits the root of trust
for all licensing into a queryable table. Anyone with audit-log read access harvests it.

**Fix.** Add `"license.generate": ["privateKey"]` and `"license.upload": ["licenseKey"]` to
`trpc-audit-redaction.ts:44`, then rotate the signing key — existing rows already hold it.

### H3 — Every per-IP rate limit on the unauthenticated tRPC surface keys on `"unknown"`

`apps/api/src/api.application.ts:50-73` (`ApiRequestContext`) and `:602-638` (`withServices`) never
declare or set a `clientIp` member. Three compositions read one through a cast:

```ts
// apps/api/src/app/api-trpc-collaborators.identity.composition.ts:1039  (front door)
clientIp: (ctx: unknown) => (ctx as { clientIp?: () => string }).clientIp?.() ?? "unknown",
// :1168 (user.register), and api-trpc-collaborators.org-group.composition.ts:428 (unsubscribe)
```

A repository-wide grep for a producer finds none. So every key below is a constant. The comment two
lines above `:1039` says the opposite — "this process reads it from the request the transport
already resolved rather than from a header a client controls" — which is why this was not noticed.

| procedure                                           | key                           | budget     |
| --------------------------------------------------- | ----------------------------- | ---------- |
| `frontDoor.route` (`front-door.api.ts:162`)         | `frontDoor.route:unknown`     | 200 / hour |
| `frontDoor.requestSignUpVerification` (`:190`)      | `…:unknown`                   | 20 / hour  |
| `frontDoor.completeSignUpVerification` (`:261`)     | `…:unknown`                   | 60 / hour  |
| `frontDoor.inviteLanding` (`:288`)                  | `…:unknown`                   | 60 / hour  |
| `frontDoor.requestFreshInvite` (`:320`)             | `…:unknown`                   | 20 / hour  |
| `user.register` (`user.api.ts:477`)                 | `user.register:unknown`       | 20 / hour  |
| `emailSuppression.resolveUnsubscribeToken` (`:147`) | `unsubscribe:resolve:unknown` | 30 / min   |
| `emailSuppression.confirmUnsubscribe` (`:169`)      | `unsubscribe:confirm:unknown` | 10 / min   |

The limiter is Redis-backed and deployment-wide
(`apps/api/src/platform/infrastructure/api-rate-limit.infrastructure.ts:29`), so these are single
global counters shared across every pod and every caller.

**Exploit.** An unauthenticated attacker issues 20 `frontDoor.requestSignUpVerification` calls in an
hour and **every** person on the deployment is refused sign-up for the rest of that window; 200
`frontDoor.route` calls deny sign-in routing platform-wide; 10 `confirmUnsubscribe` calls per minute
break one-click unsubscribe for every recipient. Separately, the per-IP anti-enumeration and
anti-brute-force control the front door is documented to have does not exist.

**Fix.** Add `clientIp` to `ApiTrpcContext` and set it in `withServices` — the request headers are
already assembled there (`api.application.ts:632`) — using the last-trusted-hop logic
`apps/api/src/features/rum/rum-rest.ts:38` and `ops/.../bug-report.api.ts:91` already use, then drop
the three casts so a future omission is a compile error.

### H4 — Organization REST apps resolve sub-org-tier permissions at organization scope

On an org app, `requires(p)` resolves `p` at `{ type: "org", id: organizationId }`
(`apps/api/src/api-rest.security.ts:464-479`). `requiresOnProject` exists for routes that name one
project, and `packages/api/src/access-policy.ts:180-184` states the reason: _"`requires(...)` would
resolve at organization scope there, so a single org-wide grant would reach every project in the
org."_ It is used **once in the entire repository**, and there is no team equivalent at all.

Affected — 11 resource-addressed routes whose permission is grantable below org scope:

| route                                                                                                               | declared                              | acts on     |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------- |
| `GET /api/projects/:id` (`project.api.ts:251`)                                                                      | `requires("project:view")`            | one project |
| `PATCH /api/projects/:id` (`:263`)                                                                                  | `requires("project:update")`          | one project |
| `DELETE /api/projects/:id` (`:353`)                                                                                 | `requires("project:delete")`          | one project |
| `POST /api/projects/:id/regenerate-api-key` (`:344`)                                                                | `requires("project:manage")`          | one project |
| `GET/PATCH/DELETE /api/teams/:id`, `…/:id/members`, `…/:id/projects` (`team.api.ts:91,141,160,182,208,236,260,283`) | `requires("team:view"/"team:manage")` | one team    |

The sibling route `GET /api/projects/:id/api-key` (`project.api.ts:331`) does it correctly and
carries a docblock explaining why — the very next route, `regenerate-api-key`, does not, for a
strictly more dangerous action that returns the new plaintext key in the response.

**Reachability.** Built-in ORGANIZATION bindings expand to the `org-admin`/`org-member` bags, which
carry no `project:*`/`team:*` (`authz/server/src/services/authz-binding-reader.service.ts:196-218`;
`roles.ts:135-172`), and `manage` implies only within its own resource
(`registry.ts:272-285`). So the passing credential is an **organization-scoped CUSTOM role** holding
`project:manage` (or `team:manage`), which the scope fence explicitly permits —
`registry.ts:336`, `if (scopeType === "ORGANIZATION") return true;` — and which `role.create`
lets an org admin define with no ceiling (see M14). Enterprise plan only (custom roles are
plan-gated, `apps/api/src/features/role/role-trpc.mount.ts:96`).

**Exploit.** `POST /api/organization/projects/<any project id in the org>/regenerate-api-key` with an
organization API key bound to such a role rotates the legacy ingestion credential of a project the
caller holds no binding on, and returns the new key — takeover of that project's ingestion plus a
denial of service for the existing integrations.

**Fix.** `requiresOnProject("project:…", { param: "id" })` on the four project routes; add a
`requiresOnTeam` and use it on the seven team routes. Note both directions are wrong today: a plain
org admin cannot pass these either, so the routes are also broken for their intended user.

### H5 — MCP access token outlives the grant it was minted from

`packages/features/hosted-mcp/server/src/transport/api-mcp/hosted-mcp.api.ts:66`
(`TOKEN_TTL_SECONDS`, 30 days) and `:505-549` (`resolveSessionContext`).

`resolveSessionContext` resolves a token from the in-memory map or Redis and returns the decrypted
`apiKey`, checking **only** `Date.now() < …expiresAt`. Nothing re-checks the minting user's
membership or permission; `authenticateRequest` (`:579-601`) validates the _project key_, not the
person. Removing someone from the project, or downgrading their role, does not invalidate a token
they already hold — only rotating the project's own API key does, and nothing on the offboarding
path does that. This defeats ADR-092 §10 ("offboarding as one proven verb").

**Exploit.** A contractor completes the MCP OAuth flow on their last day; the bearer keeps full
project authority for 30 days after their account is removed.

**Fix.** `userId` is already captured at `mcp-authorize.api.ts:249` and stored — re-probe that user's
permission in `resolveSessionContext` before returning the `apiKey`, refusing when the grant is gone.

### H6 — Legacy project key reads any organization's OTTL rules by id

`packages/enterprise/features/governance/server/src/transport/api-rest/governance.api.ts:299`

`apiKeyPermission("aiTools:view")` gates nothing for a legacy project key (see M1/C1). The bulk route
`/ingestion-templates/admin` (`:291`) additionally carries `requireUserBoundCaller`; the by-id route
at `:299-331` does not — the guard appears exactly once in the file. Path:
route → `GovernanceApp.getIngestionTemplate` (`app/governance.app.ts:298`) →
`IngestionTemplateService.getByIdForOrg` (`services/ingestion-template.service.ts:59-63`) →
`prisma.ingestion-template.repository.ts:53-59`. Tenancy is correct there, but there is no `select`
and `toTemplateDto` emits `ottl_rules` in full (`governance.api.ts:137`). The bulk list is safe only
because `listForUser` blanks the field (`ingestion-template.service.ts:45`).

**Exploit.** `GET /api/governance/ingestion-templates` with a legacy key returns every template id;
`GET /api/governance/ingestion-templates/<id>` then returns the full canonical OTTL. A legacy key is
obtainable by any member holding `project:update` via `POST /api/auth/cli/project-key`
(`governance-cli.api.ts:716`). The same data in bulk demands `aiTools:manage`.

**Fix.** Add `requireUserBoundCaller` at `governance.api.ts:324` and route the read through a
`getByIdForUser` that applies the blanking, or raise the route to `apiKeyPermission("aiTools:manage")`.

### H7 — Prompt tag assignment writes into the prompt's owning project

`packages/features/prompt/server/src/transport/api-rest/prompt.api.ts:455`

`requires("prompts:manage")` is checked on the API key's project. The lookup at `:437` deliberately
also matches org-scoped prompts owned by _sibling_ projects
(`prisma.prompt.repository.ts:294-306`, the `{ organizationId, scope: "ORGANIZATION" }` OR-branch).
The write then uses the row's own id:

```ts
projectId: config.projectId,   // ← not project.id, the id that was authorized
```

**Exploit.** Attacker holds `prompts:manage` in project A of org O; project B owns the org-scoped
prompt `checkout-agent`. `GET /api/prompts/checkout-agent` with the project-A key returns 200 and a
`versionId` (`?version=N` enumerates older ones); then
`PUT /api/prompts/checkout-agent/tags/production` with `{"versionId":"prompt_version_<old>"}` returns 200. Project B's `production` release pointer now resolves to a version the attacker chose, and
`prompts:manage` on B was never checked. The tRPC twin is safe (`api-trpc/prompt.api.ts:429` passes
`input.projectId`).

**Fix.** `projectId: project.id` at `:455`, or call the existing `checkModifyPermission`
(`prisma.prompt.repository.ts:852`) first.

### H8 — Org-wide prompt tag rename/delete gated on one project's permission

`prompt-tag.api.ts:53` (rename), `:72` (delete); REST twins `prompt.api.ts:577`, `:637`.

`policy("prompts:manage")` checks `input.projectId`; the repository then cascades across every
project in the organization — `prisma.prompt-tag.repository.ts:126-146`:
`findMany({ where: { team: { organizationId } } })` →
`promptTagAssignment.deleteMany({ tagId, projectId: { in: projectIds } })` → `promptTag.delete`.

**Exploit.** `promptTags.delete` with `{"projectId":"<project A>","name":"production"}` deletes the
organization's `production` tag and every assignment in every sibling project, silently unpinning
production prompt resolution org-wide.

**Fix.** Check these three at the organization tier, or verify `prompts:manage` on every project the
cascade touches.

### H9 — `workflows:view` escalates to a full workflow run via a legacy-key self-fetch

`workflow-optimization.api.ts:148` → `apps/api/src/app/api-trpc-collaborators.execution.composition.ts:561-583`

`optimization.chat` is declared `policy("workflows:view")`, then re-enters the _public_ REST door
carrying the project's legacy key:

```ts
const project = await options.prisma.project.findFirst({
  where: { id: input.projectId },
  select: { apiKey: true },
});
const response = await fetch(`${publicBaseUrl}/api/workflows/${input.workflowId}/run`, {
  headers: { "x-auth-token": project.apiKey },
});
```

That route declares `workflows:manage` (`workflow-run.api.ts:154-158`), but the ceiling branch runs
only for `type === "apiKey"` (`apps/api/src/app/api-handler-managed-credential.ts:93`, verified), so
for a legacy key the declared permission is never evaluated. Net requirement: `workflows:view`.

**Exploit.** A Viewer-role member calls `POST /api/trpc/optimization.chat` with
`{"projectId":"project_X","workflowId":"workflow_Y","inputMessages":[{"input":"…"}]}` and executes
any published workflow — model spend plus whatever the graph's code and HTTP nodes do — and reads its
output.

**Fix.** `policy("workflows:manage")` at `:148`; better, replace the self-fetch with an in-process
call under the already-checked scope.

### H10 — `PATCH /api/triggers/:id` mass-assigns `actionParams`

`automation/.../api-rest/automation.api.ts:66` (schema) and `:297` (forward)

`actionParams: z.record(z.string(), z.unknown())` is forwarded verbatim and
`automation.service.ts:162-164` does no per-action work. The tRPC `upsert` path does all of it —
`assertWebhookChannelEnabled` (`api-trpc/automation.api.ts:734`), `actionParamsSchemaFor` (`:906`),
`persistActionParamsFor` (`:962`, which encrypts headers and signing secrets), and the unconditional
`createdByUserId: ctx.actor().id` (`:975-978`, described in-file as "the entire anti-spoof
guarantee"). Legacy tRPC `create` refuses `SEND_WEBHOOK` outright (`:377-379`) precisely so this
cannot happen.

**Exploit.** `PATCH /api/triggers/<id>` with
`{"actionParams":{"url":"https://attacker/","headers":{"Authorization":"…"}}}` repoints a webhook with
the feature flag and the header-encryption hook both skipped, storing the secret in plaintext; on an
annotation trigger, `{"annotators":["user-<victim>"],"createdByUserId":"<victim>"}` attributes queued
items to another user. Outbound SSRF itself is fenced (the worker sends via `@langwatch/egress`,
`worker-webhook-egress.composition.ts:69`).

**Fix.** Run `actionParamsSchemaFor` + `persistActionParamsFor` in the PATCH handler and force
`createdByUserId` from the credential, or drop `actionParams` from `updateTriggerSchema`.

### H11 — Connected-agent instance keys are not tenant-namespaced

`agent/.../adapters/connected-agent-state.adapter.ts:28,33,48,73` and
`connected-agent-session.service.ts:374,382`

`instanceId` is fully client-chosen (`connected-agent.protocol.ts:47`, `z.string().min(1).max(128)`)
and the Redis keys are global: `agent_pending:${PREFIX}:${instanceId}`. `readCallForSession` does
compare projects (`:331-334`); `ack` and `result` compare only the instance id.

**Exploit.** An attacker with any project key holding `scenarios:manage` registers via
`POST /api/v1/agents/connect/register` using the victim's `instance.id`. `GET /connect/poll` drains
the victim's pending queue (denial of service by marking calls undelivered), and a `result` frame for
a call id learned that way is accepted and written to `resultKey(callId)` — the victim's dispatcher
returns attacker-supplied agent output. Rated high rather than critical only because both SDKs mint
the id from a random UUID (`sdks/typescript/src/agent/identity.ts:149`); nothing in the platform
enforces that.

**Fix.** Add `projectId` to the four key functions and
`|| stored.projectId !== session.projectId` at `:374` and `:382`.

### H12 — Gateway budget and cache-rule REST mutations check at project scope but act organization-wide

`gateway/.../api-rest/gateway-platform.api.ts:1443, 1501, 1587, 1641, 1680, 1812, 1862, 1963, 2010`

The family is `security.createProjectApp(...)` (`:703`), so `apiKeyPermission(p)` resolves at the
caller's own project (`api-rest.security.ts:349-365`). Every by-id budget and cache-rule handler then
widens to the organization:

```ts
// gateway-platform.api.ts:1662-1673 (archive budget)
const organizationId = await app.organizationIdForProject(project.id);
const row = await service.archive({ id, organizationId, actorUserId });
```

and the repository fences only on that (`prisma.gateway-budget.repository.ts:706` —
`where: { id, organizationId }`). The virtual-key routes on the same app do this correctly, via
`requireVisibleVirtualKeyForProjectCredential` / `authorizeVirtualKeyOperation`; the budget and
cache-rule routes run no per-scope check.

**Exploit.** A scoped API key holding only `gatewayBudgets:delete` on project P:
`DELETE /api/gateway/v1/budgets/<sibling-project-budget-id>` archives it, removing another team's
spend cap. Same shape for `PATCH /budgets/:id`, `POST /budgets/:id/reset` and the four
`/cache-rules/:id` routes (cache rules are organization-scoped, so any project's key manages them
all). A legacy project key skips even the project check.

**Fix.** Read the row first and authorize against its own scope — the equivalent of
`assertCanOperateOnAnyScope` the virtual-key routes already run — before
`update`/`archive`/`reset`/`cacheRuleUpdate`/`cacheRuleArchive`.

### H13 — GitHub installation takeover (installation-id confusion)

`github/.../api-rest/github.api.ts:248` → `services/github-installations.service.ts:62-90`

`handleSetup` re-checks session, nonce, membership and `organization:manage`
(`rejectUnauthorizedSetup`, `:268-330`) — all against `state.organizationId`. But `installationId`
comes from the attacker-controlled query string and is never tied to the state. `recordInstallation`
`:66` calls `appTokens.getInstallation(installationId)` using the App's own JWT, which resolves any
installation of the LangWatch App. The only guard is first-writer-wins at `:78`, and an installation
created from GitHub's own UI never gets a row — `refreshRepositories` (`:167-173`) returns early when
`tryFindByInstallationId` misses, so the `installation.created` webhook creates nothing. Such an
installation is claimable indefinitely.

**Exploit.** The attacker creates their own LangWatch org (they are its admin), calls
`GET /api/github/install?organizationId=<attacker_org>` and captures the signed `state`, then in the
same session calls `GET /api/github/setup?state=<that state>&installation_id=<victim installation id>`.
Every re-check passes. The victim's installation is now bound to the attacker's org, and
`GithubInstallationAccessService.tryMintTurnToken({organizationId})`
(`github-installation-access.service.ts:117`) mints real GitHub installation tokens for the victim's
repositories. Installation ids are small integers, so the attacker installs the App on a throwaway
org to learn one and probes neighbours.

**Fix.** After `getInstallation`, verify the acting user administers `details.accountLogin` — require
the `setup_action=install` flow to carry a user-to-server OAuth token and check `GET /user/installations`
contains the id; at minimum, store the installation id inside the signed `state` at `/install` and
reject a `/setup` whose `installation_id` differs.

### H14 — A license key carries no organization binding

`enterprise/licensing/.../services/license.service.ts:139-145`

```ts
const result = this.cryptography.validateLicense({ licenseKey });   // :139 signature + expiry only
if (!result.valid) return { success: false, error: result.error };
if (!(await this.repository.organizationExists(organizationId))) {  // :141 existence, not identity
  throw new OrganizationNotFoundError();
}
await this.repository.storeLicense(organizationId, { licenseKey, ... });  // :145
```

Nothing compares `result.licenseData` to `organizationId`, and there is nothing to compare: both
minting paths omit an organization identifier from the signed envelope
(`app/licensing.app.ts:169-186`, where `input.organizationId` is used only in the failure report at
`:191`; `services/license-generation.service.ts:51-68`). Only free-text `organizationName` travels.
The artifact is therefore a bearer token.

**Exploit.** Anyone holding any unexpired LangWatch-signed key (a trial, an eval, one scraped from a
support thread) creates a free org, becomes its owner, and calls `license.upload`
`{"organizationId":"<own org>","licenseKey":"<any valid key>"}`. On self-hosted,
`inspectPlatformAccess` (`license.service.ts:112-120`) walks every licensed organization and returns
`allowed: true` on the first valid one, so a single key unlocks deployment-wide gates including SSO.
There is no revocation list and no key id.

**Reachability caveat.** `LicenseStoragePort.storeLicense` has no production implementor on this
branch (only the abstract port at `ports/license-storage.port.ts:23` and test fakes), so the upload
write may not be composable as wired. The design defect stands; H2 is unaffected because `generate`
needs no storage.

**Fix.** Put `organizationId` (and an `instanceId` for self-hosted) inside the signed envelope in both
minting paths and refuse between `:140` and `:145` on a mismatch, with a `version: 1` grandfather
branch for existing keys.

---

## Medium findings

**M1 — `requires()` on a project REST app is not enforced for legacy project keys, and the registry
does not say so.** `apps/api/src/api-rest.security.ts:349-354` returns `next()` for any token that is
not `type: "apiKey"`, and `apiKeyCeiling` is literally `projectAuthorization` (`:387`). So the two
policy kinds behave identically, while `packages/api/src/access-policy.ts` documents `requires` as
"the caller's credential must hold this RBAC permission" and renders it as `requires X`, reserving
"legacy project keys bypass" for `apiKeyPermission` (`describeAccessPolicy:335-341`). 175 `requires(...)`
declarations across feature transports therefore read as strictly gated to any audit that consults
the registry, and are not. This is the enabling condition for C1, H6 and H9. **Fix:** make
`describeAccessPolicy` tell the truth for both kinds, and add a `requiresUserBound(...)` for routes
whose confidentiality actually depends on the check.

**M2 — Model-defaults REST writes bypass the API-key ceiling.**
`model-provider/.../api-rest/model-defaults.routes.ts:101,146,185` declare `anyAuthenticated()` and
re-authorize in `ModelProviderDefaultsWriteService.save`/`delete`, which call
`assertCanWriteDefault(actorId, scopes)` → `ModelProviderAuthorizationService.permits` →
`authz.getDecision({ userId: actorId, … })` — a **user** principal. The framework equivalent uses
`authz.hasApiKeyPermission({ apiKeyId, userId, … })` (`api-rest.security.ts:356,470`), which applies
`effective = grants(key) ∩ grants(owner)` inside `check()`
(`authz/server/src/services/authz.service.ts:165-180`, `decideWithCeiling`). So a personal API key
scoped narrowly to one project, held by an org admin, can `PUT /api/model-defaults/:id` at
ORGANIZATION scope. The route should also be `handlerManagedAuth({ permissions: […] })` rather than
`anyAuthenticated()`, so the registry records what it enforces.

**M3 — Model-defaults snapshot fails open with no user.**
`model-provider/.../services/model-provider-defaults.service.ts:160-166` —
`if (!actorId) { return configs; }` returns every organization config unfiltered, while its sibling
`writableScopes` (`:373-377`) fails _closed_ on the identical condition. `getSnapshot:47` loads
org-wide. Reached from `model-defaults.routes.ts:64-68` with `apiKeyUserId`, which is null for a
legacy project key. **Exploit:** `GET /api/model-defaults` with a legacy key for project P returns the
default-model configs of every team and project in the organization. **Fix:** invert to `return []`.

**M4 — REST provider upsert skips the per-scope write authorization.**
`model-provider/.../services/model-provider-command.service.ts:238-244` —
`if (!actorId) { return; }`. `app/model-provider.app.ts:111-115` makes `actorId` mandatory for tRPC
callers, but `api-rest/model-provider.api.ts:182-195` calls the raw service with no actor, so
`assertCanWrite` never runs (same conditional guards `delete:118` and `testConnection:157`). The
write lands on the caller's own project, so this is not itself cross-scope — but it removes the
second of two independent checks, leaving only `requires("project:update")`, which a legacy key
bypasses. **Net: a legacy project key writes provider credentials with no authorization at any layer.**

**M5 — Anomaly-rule `destinationConfig` returns the plaintext SIEM shared secret.**
`enterprise/governance/.../api-trpc/anomaly-rules.api.ts:111`, reached by `list:156` and `get:160`.
`sharedSecret` is the HMAC key used to sign outbound alerts
(`services/anomaly-alert-dispatcher.service.ts:108-109`), stored unencrypted
(`prisma.anomaly-rule.repository.ts:31-41`). A view-only member reads it and forges alerts into the
customer's SIEM. **Fix:** mirror `toIngestionSourceDto` (`ingestion-sources.api.ts:120-155`) — drop
the secret, return `hasSharedSecret: boolean`.

**M6 — `graphs.getById` bypasses the alert redaction port.** `dashboard/.../api-trpc/graph.api.ts:247-251`
hand-picks fields off the raw trigger, including `slackWebhook`, where `getAll:176` routes it through
`ports.redactActionParams`. The redactor exists because "an encrypted Slack bot token or a webhook
header value reaching a browser is a disclosure"
(`api-trpc-collaborators.analytics.composition.ts:135-141`) — and it does not strip `slackWebhook` on
either surface (`slack-provider.adapter.ts:54-58` drops only `slackBotToken`). **Exploit:**
`graphs.getById {"projectId":"project_X","id":"<graph id>"}` returns a Slack incoming-webhook URL, a
bearer credential letting the caller post as LangWatch in the customer's Slack. **Fix:** read
`actionParams` off the redactor at `:234` and add `slackWebhook` to `redactSlackActionParams`.

**M7 — Shared saved views deletable under a read permission.**
`dashboard/.../api-trpc/saved-view.api.ts:188,228,241,255` are all `policy("traces:view")`, and the
ownership guard only protects personal views (`saved-view.service.ts:141,179` —
`if (view.userId !== null && view.userId !== userId) throw`). A shared view has `userId === null` and
passes straight through. **Fix:** rename/reorder → `traces:update`, delete → `traces:delete`.

**M8 — Dataset read materializes the whole dataset; the export ceiling is never thrown.**
`dataset/.../adapters/dataset-content.adapter.ts:117-127` loads _every_ chunk before any limit is
consulted, and the budget filter is per-record rather than cumulative, so a million 1 KB rows all pass
`length <= 25*1024*1024` and `truncated` stays false. The Postgres path is cumulative and correct
(`dataset.service.ts:682-699`), so the two layouts answer the same request differently.
`DatasetTooLargeToExportError` is declared (`services/errors.ts:303`) and mapped at both boundaries
(`dataset.error-handler.ts:55-58`, `dataset-record.api.ts:91-97`) but is **never constructed outside a
test mock**. **Exploit:** a key holding `datasets:view` uploads a multi-GB CSV, then
`GET /api/dataset/my-big-dataset` (or tRPC `datasetRecord.download`, which passes `limitMb: null` —
no filter at all, `dataset-record.api.ts:250-254`) OOMs a shared multi-tenant process in one request,
repeatably. **Fix:** accumulate bytes and throw; `dataset.sizeBytes` is already a column, so the
refusal can precede the first chunk fetch.

**M9 — Shared-trace per-IP limit and view-dedup key are attacker-chosen.**
`trace/.../api-trpc/shared-trace.api.ts:217,228-230` and `enforceShareReadLimit:147-176` key on
`ports.getClientIp(ctx.req)`, wired to `clientIpOf`
(`apps/api/src/app/api-trpc-collaborators.trace-group.composition.ts:572,796`), which takes the
**first** `x-forwarded-for` entry with no trusted-proxy depth. Rotating the header removes the 120/min
per-IP limit (leaving only 60/min per token) and makes every request a distinct "viewer", so an
unauthenticated holder of a share token burns the link's view cap arbitrarily fast — a denial of the
customer's own share link.

**M10 — `apiClientAddress` prefers ten client-settable headers over the socket.**
`apps/api/src/app/api-client-address.ts:47-58`. `parseAddress` validates only the _shape_, and its own
comment says the function exists to prevent "a rate-limit key an attacker chooses". Behind an ELB
(which appends to `x-forwarded-for` and does not strip `cf-connecting-ip`), a client sending
`CF-Connecting-IP: 1.2.3.4` wins outright. This is the only DoS control on the unauthenticated
`POST /api/unsubscribe` (`unsubscribe.api.ts:61-68`). The correct shape is already in-tree —
`rum-rest.ts:38` and `bug-report.api.ts:91` take the last hop. Same class:
`enterprise/governance/.../ports/governance-ingest-rate-limit.port.ts:41-45` (first hop; each miss
costs an unindexed JSON-path `findMany`, `prisma.ingestion-source.repository.ts:68-86`), and
`ops/.../api-rest/bug-report.api.ts:89-93` where no proxy sets the header.

**M11 — Raw `error.message` / `error.stack` reaching response bodies.** ADR-045 and CLAUDE.md forbid
this outright: an unhandled cause must degrade to a generic message plus a trace id.

| file:line                                                           | surface                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `workflow/.../api-rest/workflow-studio.api.ts:168, 207, 212`        | `/code-completion`, `/post_event` (`:207` also returns `error.cause` verbatim)                         |
| `annotation/.../api-rest/annotation.api.ts:162,194,219,279,313,396` | every annotation REST route                                                                            |
| `evaluation/.../api-rest/evaluations-legacy.api.ts:551`             | `POST /api/evaluations/batch/log_results`                                                              |
| `experiment/.../api-rest/experiment-dspy-steps.api.ts:218`          | `POST /api/dspy/log_steps`                                                                             |
| `scenario/.../api-rest/scenario-generate.api.ts:204-208`            | `POST /api/scenario/generate`                                                                          |
| `evaluation/.../adapters/workflow-evaluation.adapter.ts:50`         | `traceback: [error.stack]` → `evaluation.api.ts:288` returns the Node stack with absolute server paths |
| `trace/.../api-rest/collector.api.ts:659-666, 736-741`              | ingestion-pipeline error strings in `partialSuccess.errorMessage`                                      |
| `gateway/.../api-rest/gateway-internal.api.ts:313`                  | response body names `LW_GATEWAY_INTERNAL_SECRET`                                                       |
| `ops/.../api-rest/ops-clickhouse-explain.api.ts:124`                | raw ClickHouse engine prose                                                                            |

The sharpest are `log_results` and `log_steps`: a ClickHouse or Prisma failure surfaces the driver's
message — host, port, database name — to any project key. **Fix:** re-throw and let
`createServiceApp`'s `onError` render generic + trace id; where the wire shape is fixed, substitute a
constant sentence. Every one of these already logs the detail a line above.

**M12 — Internal evaluator-service URL in `HandledError.meta`.**
`evaluation/.../adapters/http.langevals-evaluator.adapter.ts:103,110` — `meta: { evaluatorType, url, timeoutMs }`
where `url` is built from `LANGEVALS_ENDPOINT`. Traced to the wire: adapter →
`evaluation-execution.service.ts:625` → `experiment-cell-execution.service.ts:423` →
`experiment-result-mapping.process.ts:468` (`domainError: error.serialize()`, which includes `meta`,
`packages/handled-error/src/handled-error.ts:116`) → SSE at `experiment-v3.api.ts:797`, re-served at
`:1046`. **Fix:** drop `url` from both meta bags; the adjacent `logger.warn` already carries it.

**M13 — `ops:manage` enforces nothing that `ops:view` does not.**
`apps/api/src/features/ops/ops.composition.ts:395-415`. `composeOpsCheck` uses its `permission`
parameter **only** to populate the declaration at `:389`; the runtime decision at `:402-408` is
`ops.isAdmin(email) ? platform : none`, identical for both values. So ~40 `manage(...)` mutations
(drain a queue, discard dead letters, delete a blob, roll back a tenant's migration) are gated exactly
as tightly as `listQueues`, while the transport's docblock (`ops.api.ts:6-9`) and every registry audit
report a two-tier operator model. The `requireDestructiveOpsAuth` typed-confirmation guard
(`ops.api.ts:247`) is real but covers 7 procedures.
**Do not "fix" this by making the declared permission authoritative without also fixing M14** — that
would turn a tenant-grantable `ops:manage` into live platform access.

**M14 — No creator ceiling on custom roles, and the scope fence permits platform-tier grants.**
`role.create` (`apps/api/src/features/role/role-trpc.mount.ts:150`, `organization:manage` + plan gate)
accepts `permissions: authzPermissionSchema[]` (`api-trpc-collaborators.product-group.composition.ts:424`),
which is the **entire** registry including `ops:view`/`ops:manage` and `project:manage`/`team:manage`
(`registry.ts:230-233`), with no check against the creator's own grants
(`role/.../api-trpc/role.api.ts:95-107`). `roleBinding.create` then binds it at ORGANIZATION scope,
which `bindingScopeCanGrantPermission` permits unconditionally:

```ts
// packages/features/authz/contract/src/registry.ts:334-338
if (scopes.includes("platform")) return true; // LEGACY-QUIRK(C)
if (scopeType === "ORGANIZATION") return true;
```

— directly contradicting the same file's docblock at `:313-318` ("platform resources are never
grantable by org/team/project bindings at all") and the `ops` resource definition at `:99-103`. Today
this is latent: the only surface declaring `ops:*` is `ops.api.ts`, which ignores it (M13). It is also
the precondition that makes H4 reachable. **Fix:** drop the `platform` early-return at `:337`, and
intersect a custom role's permission list against the creator's own grants at definition time.

**M15 — api-key mint-time ceiling under-approximates built-in role bags.**
`api-key/.../services/api-key-grant-policy.service.ts:190-206`. For a `CUSTOM` binding,
`assertCeiling` checks the full raw permission list (correct). For a built-in role it checks a single
representative permission — `MEMBER` at project scope checks only `project:update`, while the MEMBER
bag holds ~50 permissions including `secrets:manage`, `virtualKeys:rotate` and `traces:share`
(`roles.ts:44-72`). A caller holding a narrow custom role with `project:update` can mint a key whose
stored bindings claim the whole MEMBER bag. Runtime is capped by the live owner ceiling
(`authz.service.ts:165-180`), so this is a defence-in-depth gap and a stored-state lie that widens
silently if the owner is later promoted. **Fix:** expand the role to its permission set via
`builtinRolePermissions` and check each.

**M16 — Governance CLI routes declare `permissions: []` and check none.**
`governance-cli.api.ts:825` (`/governance/status`) never calls `refuseWithoutPermission` — the missing
line sits between `:833` and `:834` — where the console checks `governance:view` for the same
`resolveSetupState` (`api-trpc/governance.api.ts:109`). `:844`
(`/governance/ingestion-templates`) has neither a permission nor a plan gate where both other doors
onto `templateListForUser` check `aiTools:view`. The file's own header (`:36-37`) states the rule.

**M17 — `routingPolicy.create` persists caller-supplied `scopeId` unvalidated.**
`enterprise/governance/.../services/governance-routing.service.ts:53-62` →
`prisma.governance-routing.repository.ts:117` (`scopes: { create: input.scopes }`). `scopeId` is not a
scope-tier field name, so the lineage guard never sees it. Reads all filter on `organizationId`
today, so this is unvalidated foreign references and keyspace squatting rather than a live
cross-tenant read. **Fix:** an `assertScopesInOrganization` mirroring the existing
`assertProvidersReachable`.

**M18 — Authenticated open redirect via Stripe return URLs.**
`enterprise/billing/.../api-trpc/subscription.api.ts:196,221,261` take `baseUrl` as a bare
`z.string()` and interpolate it into `success_url`/`cancel_url`/`return_url`
(`subscription.service.ts:197,230,455-456`), returning it for the browser to follow.
`subscription.create {"plan":"FREE","baseUrl":"https://attacker.example"}` returns that URL directly;
on the paid paths it is laundered through `checkout.stripe.com`. Requires `organization:manage`, so it
caps at phishing with a trusted referrer. **Fix:** validate against the deployment's own origin.

**M19 — `POST /api/dataset/generate` has no CSRF guard its sibling has.**
`dataset/.../api-rest/dataset-generate.api.ts:85-103`. Authorization is correct (session resolved,
`datasets:manage` probed on the caller-named project). What is missing between `:86` and `:91` is
`if (isCrossSiteRequest(c)) return 403`, which the sibling door owns
(`apps/api/src/features/dataset/dataset-direct-upload-auth.ts:98-100`). Hono's `c.req.json()` is
content-type-agnostic, so an `enctype="text/plain"` form post is a CORS simple request. A victim with
`datasets:manage` visiting an attacker page triggers a 50-step, 16k-token model run billed to their
project. Not readable by the attacker (no CORS header) — cost and quota abuse. **Caveat:** no
`sameSite` attribute is configured anywhere in `packages/` or `apps/`; the effective value comes from
better-auth's defaults, so end-to-end reachability is **unproven**. The missing guard is proven.

**M20 — hosted-mcp sits outside the AccessPolicy registry.**
`hosted-mcp/.../api-mcp/hosted-mcp.api.ts` is mounted as an `ApiRawRequestSurfacePort`
(`apps/api/src/features/mcp/hosted-mcp.mount.ts:26`), so its 33 route verbs — including an in-process
OAuth implementation with dynamic client registration, `Access-Control-Allow-Origin: *`, and tokens
cached in memory beside Redis — declare no `AccessPolicy` and appear in no route-registry audit. C1
and H5 both live here. **Fix:** register the family's routes so `policyPermissions` can see them,
even if the handler keeps managing its own credential.

---

## Low findings

- **L1** `PrismaDatasetRepository.update` omits `projectId` (`prisma.dataset.repository.ts:91`). The
  tenancy guard rejects it at runtime, so it is a broken path (500) rather than a leak.
- **L2** `WorkflowRepository.findCopies` accepts `projectId` and never uses it
  (`prisma.workflow.repository.ts:268-273`); `pushToCopies` drops the filter when `allowedProjectIds`
  is absent (`workflow.service.ts:411,424,428`; same in `evaluator.service.ts:319,337`). **Unproven
  reachable** — the tRPC caller does its own per-copy permission loop (`workflow.api.ts:762-768`).
- **L3** Client-chosen ids as a cross-tenant existence oracle: saved views
  (`saved-view.api.ts:209` → `saved-view.service.ts:103`, P2002 uncaught) and agents
  (`agent.schemas.ts:47-61`). Ids can also be pre-claimed to break a victim's later create.
- **L4** Legacy `/api/files/:id` distinguishes "exists in another tenant" (403) from "no such object"
  (404): `stored-object/.../clickhouse.stored-object-owner.repository.ts:38-44` has no tenant
  predicate. Ids are content-addressed so not enumerable, and the rate limit runs first.
- **L5** `POST /admin/:resource` forwards `params.data` and spreads `query.where`/`filter` into Prisma
  (`ops/.../prisma.admin-backoffice.repository.ts:81,141-176`) — mass assignment over `organization`,
  `subscription`, `team`, `project`, `user`. Reachable only with an `ADMIN_EMAILS` session; blast
  radius, not a tenant hole. The read side already has `*_SAFE_SELECT`; the write side has no
  equivalent.
- **L6** `ops-clickhouse-explain.api.ts:142` returns early on a length mismatch before
  `timingSafeEqual`, making the operator secret's length observable.
- **L7** Signature replay windows with no nonce cache: `gateway-internal.api.ts:379-393` (±300s) and
  `elevenlabs-webhook.api.ts:76-146` (±1800s). Both compare constant-time and sign the body, so this
  is bounded replay, not forgery.
- **L8** `gateway-internal` `/codex/refresh` (`:1087`) and `/config/:vk_id` (`:1158`) are tenancy-free
  by design, gated solely by one global HMAC secret. Recorded as blast radius.
- **L9** `presence.leave` accepts any session id in the project
  (`presence/.../presence.api.ts:120-130`) — peer session ids are published in the presence stream, so
  any member can evict another's presence session. Griefing only.
- **L10** The scope-lineage guard is inert on `ops.*` and `featureFlag.*` (the policy is applied
  before `.input()`, `ops.api.ts:121-131`, `feature-flag-trpc.mount.ts:26-32`). Both do their own
  in-handler binding; recorded so a future procedure is not assumed to inherit it.
- **L11** `retentionPolicy` delete and upsert address rows without `organizationId`
  (`prisma.data-retention.repository.ts:49-89`); safe only because
  `policy.assertCanWriteScope` runs first (`data-retention.api.ts:243`).
- **L12** Repository update/delete `where` clauses omitting the tenant, correct only because the
  service reads first (TOCTOU): `prisma.ai-tool-catalog.repository.ts:169,192`;
  `prisma.governance-routing.repository.ts:143-146,168-171,211`; `prisma.anomaly-rule.repository.ts:27,63`.
  The correct shape is in-tree at `prisma.ai-tool-catalog.repository.ts:328-331`.
- **L13** `ingestion-source.service.ts:95` — plain `===` on a SHA-256 digest in an auth path.
- **L14** `personal-sessions.api.ts:74-89,107-114` check `organization:view` on an `organizationId`
  the query then discards. Rows are the caller's own, so not a tenant break.
- **L15** Unvalidated cross-org id references on `anomalyRules.create` `scopeId`
  (`anomaly-rules.api.ts:64`) and `ingestionKey.install/rotate` `templateId` (`ingestion-key.api.ts:45`).
- **L16** Prototype-chain lookup turns an arbitrary `field` into an interpolated SQL fragment:
  `trace-list-read.service.ts:480` — `SUGGEST_COLUMN_MAP["constructor"]` is truthy, passes the
  `if (!column)` guard, and a `Function` object is template-interpolated into ClickHouse SQL. **Not
  injection** (the string is a JS builtin's source) and tenancy is unaffected; it is an unhandled 500
  per request. `trace-query.clickhouse.adapter.ts:194` documents the same hazard and uses a `Map`.
- **L17** Blank-string-tolerant scope ids (`z.string()` without `.min(1)`) at
  `workflow.trpc-schemas.ts:20-95`, `dashboard.api.ts:60`, `saved-workbench-chart.api.ts:134-135`,
  `saved-view.api.ts:144,229,242,256`, `monitor.schemas.ts:45`. Denied by `requireDeclaredScope`
  today; the dashboard _contract_ schemas already use `.min(1)` and are the pattern to copy.
- **L18** `where` spread from the input object rather than an explicit predicate:
  `scenario.repository.ts:217`, `prisma.experiment.repository.ts:43,54,110,502`, plus eight sites in
  automation/monitor/dataset. Safe today; the tenant filter survives only while the schema keeps
  `projectId` required.
- **L19** `monitor-performance.repository.ts:29` interpolates `'${validateTimeZone(timeZone)}'`. Not
  exploitable — the value round-trips through `Intl.DateTimeFormat` with a `"UTC"` fallback.
- **L20** The CLI device flow declares `credential: "session"` on `/device-code`, `/exchange`,
  `/refresh` and `/lookup` (`auth-cli-device-flow.api.ts:247-251`), but the first three require no
  session — the device code is the bearer. `credentialClassFor` therefore misreports four endpoints,
  and `access-policy.ts:73-95` says that field exists precisely so "which credential reaches this
  route" is a property of the route.
- **L21** `saved-workbench-chart.api.ts:495-498` spreads the validated body **after** the tenant-bound
  fields. Safe today (plain `z.object`, unknown keys stripped); one `.passthrough()` from a scope
  override.
- **L22** `governance-cli.api.ts:1067-1068` passes `client_info.device_label` unsanitized where the
  project branch runs `sanitizeDeviceLabel` (`:1019-1024`).
- **L23** `subscription.api.ts:168-169` — `totalMembers`/`totalTraces` are bare `z.number()` where
  `previewProration` already declares `.min(1)` at `:240`.
- **L24** `enterprise/billing/.../services/currency.service.ts:65-80` reads client IP headers with no
  trusted-proxy check. Affects only which of two currencies a pricing page shows.

---

## Latent — defective code on a surface this branch does not mount

Fix these **before** the surface is re-mounted, not after.

- **Stripe webhook** (`createStripeWebhookRestApp` has no call site; `WebhookService.handleEvent` has
  no caller in `apps/`). The transport is correct — signature verified over raw bytes before any parse
  (`stripe-webhook.api.ts:75-78`). The service behind it is not: no `payment_status` check before a
  signed license is minted and emailed (`billing-webhook.service.ts:270` →
  `license-purchase.service.ts:77-83`; delayed-notification methods fire
  `checkout.session.completed` with `payment_status: "unpaid"`, which with H14 is a free permanent
  ENTERPRISE key); `linkStripeId` binds no tenant
  (`prisma.subscription.repository.ts:95`, `where: { id: input.id }`, with `client_reference_id`
  prefix-stripped by `.replace()` rather than asserted, `billing-webhook.service.ts:484`); and no event
  de-duplication, while `customer.subscription.updated` forces `status: ACTIVE` unconditionally
  (`prisma.subscription.repository.ts:206-207`).
- **`/api/ingest/v1/logs` spend-ledger replay.** `governance-ingest.api.ts:641` →
  `spend.insertDebit(rows)` at `:968`, keyed on payload-supplied `gatewayRequestId` (`:957`), with
  `resolveSource` checking only a bearer and a path id. Re-POSTing a captured body drives an
  organization past its budget and hard-blocks its own gateway traffic. No composition supplies the
  `spend`/`logCollection`/`metricCollection` ports
  (`governance-ingest-rest.mount.ts:133-139`) — but the OpenAPI document advertises all three
  (`openapi-document.surface.ts:341-343`), so integrators will wire them.
- **Internal error text echoed to the sender** on those same routes:
  `governance-ingest.api.ts:711` (`parseHint = String(err)` inside a catch spanning Prisma and
  ClickHouse) emitted unconditionally at `:738` and `:830`. The mounted trace route is safe (`:554`
  gates the hint on `eventCount === 0`).
- **MCP governance tools skip the permission check for API-key-only sessions.**
  `api-mcp/governance-tools.api.ts:144` — `if (!rctx.callerUserId) return null;` inside `requireRead`.
  `governance_ingestion_templates_get` takes that path and returns `ottlRules` in full, which
  `_admin_list` treats as `aiTools:manage`-only by its own comment (`:184-186`). `sessionTools` is
  never passed by any composition. **Fix before mounting:** use the `NEEDS_OAUTH_PREFIX` rejection
  `requirePermission` uses.

---

## Verified sound — checked, no finding

- **api-key tRPC (9 `noPermission` procedures).** Every one calls `ApiKeyApp.ensureMember` →
  `ApiKeyGrantPolicyService.ensureCallerIsOrgMember` → `authz.hasPermission({ organization:view })`
  before reading anything (`app/api-key.app.ts:113-330`), and the admin-only paths ask `isOrgAdmin`.
  The payload `organizationId` is bound to the caller.
- **role / role-binding.** All at `organization:manage` (`role-trpc.mount.ts:147-215`), and every
  binding write runs `validateScopes({ organizationId, scopes })` plus `validatePrincipal`
  (`authz-binding-writer.service.ts:48-200`), so a scope from another organization is refused.
  `applyMemberBindings` finds deletions org- and user-bounded. (The definition-time gap is M14.)
- **Front door.** Five public procedures with declared policies, no-oracle discipline (`route` is a
  mutation on purpose so no per-address cache entry exists), and per-procedure budgets. The budgets
  are the subject of H3; the design is otherwise exemplary.
- **SCIM protocol.** `verifyToken` (`scim.service.ts:181-196`) is an indexed lookup on a SHA-256
  digest — no secret comparison exists to be non-constant-time — and `organizationId` comes from the
  stored record. All 12 bearer routes pass `c.get("scimOrganizationId")` down (14 uses, zero payload
  org ids). Group mutations resolve through `tryFindGroup({ id, organizationId })`. The SCIM role is
  hardcoded `"MEMBER"`, and the patch surface exposes no role path. **A token from org A cannot
  provision into org B.**
- **The webhook feature (23 surfaces).** Organization always from the credential; deliveries go
  through `packages/egress`'s `WebhookEgressService` (`http.webhook-destination.adapter.ts:49`) with
  the SSRF fence, redirect refusal and dispatch cap; URLs validated at admission too
  (`prisma.webhook-endpoint.repository.ts:798-807`); signing is HMAC-SHA256 over `t.body` with
  `timingSafeEqual` and a 5-minute tolerance; the signing secret crosses exactly twice (create,
  roll-secret) and the SQS `secretAccessKey` is never returned.
- **SSO is not a customer surface.** All 11 procedures call `requireOperator` first
  (`sso-connection.api.ts:252-264`) → `ops.isAdmin`, an env allow-list that fails closed on a missing
  email, so an API-key caller can never pass. A plain member cannot create or modify an SSO connection.
- **Ops is not reachable with a project key.** tRPC authentication is browser-session-only
  (`api-request.policy.ts:97` → the Better Auth cookie adapter), and all 92 procedures go through
  `view`/`manage`/`probePolicy` → `ops.isAdmin` against `ADMIN_EMAILS`
  (`admin-access.service.ts:27-30`), fail-closed on an empty list. `POST /admin/impersonate` declares
  `credential: "session"` and resolves an auth session, so a key yields `AdminSurfaceHiddenError`.
  There is no self-service email change (better-auth's `changeEmail` is not enabled), so the
  allow-list is not bypassable that way.
- **Virtual keys and secrets.** All 10 virtual-key procedures use `authorizeInService` and the service
  enforces (`virtual-key-authorization.service.ts:158-330,467`), including denying an empty scope list
  rather than granting vacuously (`:173`). Plaintext is returned by exactly `create` and `rotate`,
  never as an input, so audit never records it. `safeSecretSelection`
  (`prisma.secret.repository.ts:11-19`) omits `encryptedValue` from every read and there is no reveal
  endpoint. Provider credential masking is **deny-by-default**
  (`contract/src/model-provider-credential.ts:22`), so an unrecognised field masks rather than leaks.
- **Entitlement.** No plan/quota/limit mutation exists — `plan.api.ts` is one `organization:view`
  query. No mass-assignment surface.
- **Feature flags.** `setExperimentTenantPolicy` checks `featureFlags:manageExperiments` at exactly
  the scope it writes (`feature-flag.api.ts:255-268`), and the schema admits only project/organization
  — no global variant. Global writes exist only on `ops.api.ts:945/963/979`.
- **Data privacy / data retention.** Every scope write runs `assertCanWriteScope` at the target
  scope's own tier; data-privacy runs `assertScopeBelongsToProjectOrganization` **before** the
  permission probe (`data-privacy-scope-authorization.service.ts:64-88`).
  `triggerRetroactiveUpdate` ignores a client-supplied retention value and re-resolves it server-side.
- **Stored objects.** The storage key is `row.storage_uri`, read from the row and never from the
  request (`stored-objects.service.ts:322`); `findById` is parameterised with `project_id` first. No
  traversal primitive exists.
- **Unsubscribe token.** `UnsubscribeTokenService` signs `base64url(JSON).hex(HMAC-SHA256)` over a
  normalized payload, verifies with `timingSafeEqual` (`:78-87`), and throws rather than signing on an
  empty key (`:113-121`). `confirmUnsubscribe` takes `projectId` and `email` from the **token**, never
  the request. Not forgeable, not enumerable; unbounded replay is a documented ADR-031 decision.
- **Governance ingest source binding.** `governance-ingest.api.ts:459` —
  `if (c.req.param("sourceId") !== source.id)` binds the path id to the secret-resolved source, with
  the throttle ahead of the secret lookup.
- **Trace, analytics and share** (90 surfaces). Every scoped id checked is the id queried; all 20
  ClickHouse repository files lead with a bound `TenantId`; the share token is the whole authorization
  and the read re-binds `projectId` from the stored share row, so a foreign `traceId` yields a 404.

---

## Unproven — say so rather than guess

1. **SSRF on the model execution path.** The credential _probe_ is fenced
   (`ssrf.model-provider-egress.adapter.ts` → `packages/egress`, IP pinning, redirects refused) and is
   wired in both compositions. Execution is not: `model-provider-execution-handle.service.ts:130-136`
   and `playground.api.ts:126-130` post to the deployment's own `executionProxyBaseUrl` and pass the
   customer's `api_base`/`api_key` onward as `x-litellm-*` headers. Whether the customer-chosen URL is
   validated is a property of **`services/nlpgo` (Go)**, outside this scope. The same applies to
   workflow HTTP nodes. The sibling `httpProxy` path _is_ fenced (`services/nlpgo/cmd/root.go:60-76`).
2. **LangWatchQL execution tenancy.** Isolation for `langWatchQL.query` and
   `SavedWorkbenchChartService.run` is not a WHERE predicate — it is the restricted ClickHouse
   identity hashed from `project.lwqlKey` (`query.api.ts:150-159`) plus row policies and approved views
   provisioned by `langwatch-ql/production-provisioning.ts`. Admission and the run identity are
   server-resolved and correct; whether the deployed row policies actually enforce the key map is
   database state, not source.
3. **Whether an API-key credential can reach the tRPC surface at all.** `ApiRequestPolicy.createContext`
   resolves a Better Auth session only, but not every context factory was enumerated. If a
   key-authenticated tRPC lane exists, M1's legacy skip applies there too.
4. **MCP tool argument handling.** The tools come from `@langwatch/mcp-server`, outside the feature
   packages. The authority model is proven (every tool runs under the project key via `runWithConfig`);
   whether any tool takes a `projectId` argument that escapes its session's key is not.
5. **Cross-tenant obtainability of a connected-agent `instanceId`** (H11). No leak path was found in
   the audited surfaces; log sinks, metric labels and trace attributes were not swept.
6. **Stripe account state** behind the latent billing findings: whether a non-license Payment Link
   exists, and whether the license link enables a delayed-notification method. The missing checks are
   proven; their triggerability is dashboard state.
7. **Whether an ingress rewrites `X-Forwarded-For`** ahead of the API process. M9/M10 assume it does
   not, because nothing in the application asserts it; deployment charts were not read.
8. **Where `ports.audit.record` persists to**, and who can read it — traced only as far as
   `trpc-runtime-policy.ts:274`. H2 stands regardless: the key leaves the process unredacted.
9. **BYOC S3 endpoint egress.** `DatasetObjectStorageS3ClientResolver.acquire` passes a per-project
   stored `target.endpoint` into `this.aws.build(...)`
   (`dataset-object-storage-resolver.adapter.ts:73-81`). Whether `@langwatch/aws-client` applies the
   egress policy, and whether that endpoint is customer-settable, was not established.
10. **`ctx.can` on `MonitorTrpcContext`** (used by `monitors.copy`, `monitor.api.ts:228`) is
    process-supplied and not filled in `monitor-trpc.mount.ts`. If it ever resolves to a constant
    `true`, the source-project gate at `:231-236` is inert.
11. **Whether OTLP _resource_ attributes reach `trace_summaries.Attributes`** under
    `langwatch.ingestion_source.*`. `withOriginAttrs` scrubs span and log-record attributes but not
    the resource. Cross-tenant forgery is impossible either way; intra-org attribution forgery depends
    on this hoist.
12. **`WorkflowService.pushToCopies` / `EvaluatorService.pushToCopies`** reachability with a missing
    `allowedProjectIds` (L2) — no caller omits it today.
