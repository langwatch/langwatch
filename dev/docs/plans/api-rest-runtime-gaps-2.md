# Grow the REST runtime, round two: doors without a permission, route-scoped checks, addressing, credentials

**Date:** 2026-09-08 · **Owner lane:** one Opus agent in `packages/api` only, reviewed by Fable
**Follows:** round one (`864a7151df`: facts, v1-only, deprecation, public routes) and the
organization door (`5080220f88`: `withCredential("organizationKey")`, `DoorScope`, `doorScopeOf`).
`packages/api/specs/*.feature` is the oracle; each item lands with its unit test in the folded `__tests__/<file>` and a
retagged or new scenario bound by `@scenario`. No new file under `rest/` or `trpc/`.

1. **A door credential with no permission.** `/api/v1/coding-agent` (one route) and `POST /api/projects` want a resolved
   credential and nothing more. Add `.withAccess(anyAuthenticated({ reason }))` beside `publicRoute`: the door still
   resolves the credential and scope, no permission is asked of it, the registry records the class, the document keeps the
   security scheme. `assertRouteReady` accepts it. Refused if combined with `withPermission`.
2. **A permission checked at the scope a route names.** `/api/projects` (5 routes, project named in the path under an
   organization key) and `/api/teams` (7 routes, team in the path). Add `.withPermission(permission, { at: "route", param:
   "projectId" | "teamId" })`: the door authenticates the credential as today, then the runtime asks
   `identity.authorize({ caller, permission, target: { tier, id } })` (new optional port method; a mount that does not
   supply it refuses such a declaration at mount time by name) after the params are parsed. The handler receives the
   credential's scope and the route target both.
3. **Addressing variants.** `RestAddressing` gains `"v1-in-path"` (`/api/<ns>/v1/...`, no dated addresses: webhooks 12
   routes, gateway 4) and a `dated` option `{ v1Twin: false }` (`/api/projects` has `v1Alias: false`). The document lists
   exactly the addresses served. Read the old families (`git show 1dfbc5dcf1^:packages/features/webhook/server/src/transport/api-rest/webhook.api.ts`
   and gateway's) for the paths they served.
4. **A door for a deployment-wide secret with no tenant scope.** platform-health today declares `publicRoute` and checks
   its monitoring key in the route, so the document says `security: []` for a secret-guarded family and the registry
   records `public`. Add `withCredential("internalSecret")`: the mount's `identity.authenticate` resolves a
   `RestResolvedInternalCredential` (new, `credential.ts`) with no scope; the handler gets `scope: null` and
   `actor: null`; the registry records `credentialClass: "internal_secret"`; the document publishes the matching scheme.
   Then say in the report the exact lines platform-health's declaration and mount change to.
5. **Declared non-2xx success statuses.** An unhealthy platform report is an answer, not an error: `.responds({ 200:
   schema, 503: schema })` on a route lets the handler return `{ status: 503, body }` typed by the declaration; the
   document lists both; the logger middleware logs it at info. `respond()` keeps its one-status form.
6. **The SCIM bearer token as a credential kind.** `CredentialClass` knows `scim_token`; `Credential` and
   `DOOR_SCOPE_TIER` do not. Add it as a third door (`withCredential("scimToken")`, organization tier, its own security
   scheme) so `scim-webhook-intake.api.ts` can convert. `instance_admin_api_key` stays out; say so.

Not in this lane: rate limit and cache, raw request bytes, any-method routes, optional credentials (ops bug-report),
raw responses (image-proxy, rum). List them in the report as still open with their callers.

Rules: Opus; Read/Edit/Write only, read before delete; `packages/api/**` only (specs included); never root
typecheck/lint/format; allowed `pnpm typecheck:one packages/api`, `pnpm --filter @langwatch/api test:unit`, `npx oxlint
<files>` (counts on `runtime.ts`/`access.ts` must not grow past HEAD's), `pnpm --filter @langwatch/architecture-lint
check:feature-parity` (`packages/api/specs` lines). No git writes, no baselines, no `.env*`, no re-exports, no `as
unknown as`, no `try*`, no inline `import()`, comments ≤5 lines, `HandledError` codes for knowable failures.
`runtime.ts` is 2,107 lines: if an item needs more than ~150 lines, fold it into the file that owns the noun
(`credential.ts` for credentials, `openapi.ts` for the document, `access/access.ts` for access kinds) rather than growing
`runtime.ts`, and say in the report how the nine files should split next (that split is a lane of its own).
Report: the six items one paragraph each with public names and the pinning test; the exact consumer lines (coding-agent,
projects, teams, webhooks, gateway, platform-health, scim); exit outputs verbatim; scenarios retagged / added / left.
