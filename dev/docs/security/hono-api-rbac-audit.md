# Hono API RBAC + tenant-isolation audit

This documents the audit of every external/HTTP endpoint on the LangWatch Hono
API surface (the routes used by SDKs, the CLI, the MCP server, and our own
frontend, as opposed to tRPC) for three properties:

1. **Authentication** — is the caller identified at all?
2. **Authorization** — does the route require the correct RBAC permission?
3. **Tenant isolation** — can a credential for one organization/project ever
   read or mutate another tenant's data?

The motivation: tRPC enforces permissions through a fail-closed,
compile-time-checked middleware (`enforcePermissionCheck` + the
`checkProjectPermission`/`checkOrganizationPermission` builders). The Hono
surface had no equivalent guarantee — a route enforced RBAC only if a developer
remembered to chain `requirePermission("resource:action")`, a positional,
forgettable middleware.

## Scope

258 routes across 47 route families were audited (every `app.ts` /
`app.v1.ts` under `langwatch/src/app/api/**` plus every file under
`langwatch/src/server/routes/**` and the EE admin routes). Each route was
classified by auth mechanism, declared vs. expected permission, and
tenant-scoping posture; high/critical and cross-tenant findings were then
adversarially re-verified against the actual code path.

## Headline counts

| Metric | Count |
|--------|-------|
| Routes audited | 258 |
| No authorization gate where one was expected | 26 |
| Declared permission weaker/wrong vs. action | 31 |
| High-risk cross-tenant exposure | 2 |
| Routes with no permission/tenant regression test | 189 |
| Confirmed/partial vulnerabilities after verification | 22 (3 high, 6 medium, 13 low) |

## Confirmed vulnerabilities and remediation

### Authentication (fail-open / missing)

- **`cron` shared-secret was fail-open.** `validateCronKey` compared the header
  directly to `process.env.CRON_API_KEY`; when the secret was unset,
  `undefined === undefined` returned `true`, so a credential-less request could
  trigger destructive jobs (`traces_retention_period_cleanup`,
  `old_lambdas_cleanup`). **Fixed:** the guard now lives in
  `server/routes/_lib/internal-secret.ts`, fails closed when the secret is unset
  or empty, and uses a constant-time comparison.
- **`/api/rerun_checks` and `/api/start_workers` had no authentication.** These
  ops/worker endpoints accepted any caller (and `rerun_checks` took an
  arbitrary `projectId`). **Fixed:** both now require the internal shared secret.

### Authorization (missing RBAC gate)

Five project-scoped endpoints authenticated the caller but enforced no
permission, so any valid project token reached the handler regardless of its
role bindings. **Fixed** by migrating each to the `SecuredApp` builder, which
makes the permission a mandatory, compile-time-checked argument:

| Route | Permission |
|-------|-----------|
| `GET /api/model-providers` | `project:view` |
| `PUT /api/model-providers/:provider` | `project:update` |
| `POST /api/analytics/timeseries` | `analytics:view` |
| `GET /api/experiments` | `workflows:view` |
| `GET /api/model-defaults` | `project:view` |
| `POST /api/copilotkit` | `prompts:view` |

Permissions mirror the equivalent tRPC procedure where one exists (the
authoritative, type-checked surface) rather than a heuristic guess.

### Tenant isolation (cross-tenant)

- **`POST /api/experiments/abort` could abort another project's run.** The
  permission check gated the body's `projectId`, but the `runId` was never
  verified to belong to it. **Fixed:** the run state is loaded and the request
  404s unless the run is owned by the authenticated project (mirrors
  `GET /api/experiments/runs/:runId`).
- **`POST /api/gateway/v1/budgets` could scope a budget to another org's team or
  project.** `organizationId` was derived from the caller, but the scope's
  `teamId`/`projectId` was request-supplied and unchecked. **Fixed:** the budget
  service now verifies the scoped team/project belongs to the budget's org
  (mirrors the existing PRINCIPAL-scope guard).
- **`PUT`/`DELETE /api/model-defaults/:id`** relied on the invariant that every
  config has at least one scope attachment for its per-scope write check to run.
  **Fixed:** an orphan config (zero scopes) now 404s rather than being editable
  by any authenticated caller.

### Documented, not changed

- **Legacy project keys** intentionally bypass per-permission RBAC but are bound
  to exactly one project — this is the documented model and never extends across
  projects or organizations (token resolution rejects a key used against a
  project outside its organization).
- **SCIM, auth-cli device-flow, health probes, tRPC mount, EE admin** authenticate
  by their own mechanism (SCIM token, device-code, none-by-design, browser
  session + per-procedure RBAC, super-admin allowlist). Each is classified in the
  legacy allowlist with that rationale.

## The durable guarantee

Two layers prevent regression:

1. **Type-level — `SecuredApp`** (`server/api/security/`). The builder's verb
   methods are only reachable through `.access(policy)`; the bare app exposes no
   `.get/.post/...`. Omitting the policy is a compile error. The policy is one of
   `requires(permission)`, `anyAuthenticated()`, `publicEndpoint(reason)`, or
   `internalSecret(reason)`.

2. **CI backstop — router introspection.** A test boots the fully composed
   router and asserts every mounted endpoint is either registered through
   `SecuredApp` (its policy recorded in the route registry) or listed in the
   documented `LEGACY_UNSECURED_ROUTES` allowlist. A new route added via raw
   Hono with no policy fails this test, so no human or agent can add an
   unclassified endpoint by accident. The allowlist is the migration backlog —
   it only shrinks as families move onto the builder.

See `specs/security/api-endpoint-authorization.feature` for the behavioral
specification and bound tests.
