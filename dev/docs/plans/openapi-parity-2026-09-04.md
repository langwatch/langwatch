# OpenAPI parity — frozen documents vs. what the API process mounts

Read-only audit, 2026-09-04, branch `feat/strict-feature-layout-v0` (worktree
`/Users/afr/Source/github.com/langwatch/langwatch`), compared against
`origin/main`. Nothing was edited except this file.

## Verdict

**The branch breaks 24 documented operations, and its own drift guard is red.**

`pnpm --filter @langwatch/platform-api run task openapi-check` exits 1 with
**27 regressions**, and
`apps/api/src/tasks/openapi-document/__tests__/openapi-document.unit.test.ts:274`
("passes today, with every unserved operation accounted for in the baseline")
**fails**. Three of those 27 are a blind spot in the describer rather than a
real gap (below), so the honest count of documented-but-unreachable operations
is **24**: 23 management-family operations plus one trace read.

The single cause behind 23 of the 24 is **`packages/api`'s ADR-002**: the
versioned-service mount lost its **bare alias**. `origin/main`'s
`packages/api/src/route-mounting.ts:26` reads "Mounts all resolved versions,
namespace guards, **and the bare latest alias**" and mounts it at
`:70-82` (`status: "unversioned"`, `version: null`). The branch's
`packages/api/src/rest/route-mounting.ts:20-24` reads "`createService` has no
bare alias (ADR 002)" and mounts only `/<basePath>/<date>/…` and
`/<basePath>/latest/…`. The frozen OpenAPI document still publishes those
families at their bare paths — `GET /api/organization`, `GET /api/roles`,
`POST /api/role-bindings`, `POST /api/scim-tokens` and nineteen more — so every
generated client calls a URL that now 404s. The decision was taken inside
`packages/api` (`packages/api/adrs/002-explicit-version-namespaces.md:49`) and
never reconciled with the document, which is frozen and therefore cannot be
corrected in place.

The two documents do **not** disagree with each other: `docs/api-reference/openapiLangWatch.json`
and `apps/api/src/features/discovery/openapi-document.json` are **byte-identical**
(`diff -q` reports no difference; 64,073 lines each, 298 operations, 190 paths).
They are also semantically identical to main's `platform/app/src/app/api/openapiLangWatch.json`
— same 298 `METHOD path` keys, zero difference after `json.tool` normalisation.
The document did not change on this branch; only the surface under it did.

### Counts

| Table | What | Count |
| --- | --- | --- |
| (a) | Documented, not mounted on the branch | **30 raw / 24 real** (23 bare-alias + 1 transcript; +2 document residue, +4 describer blind spots) |
| (b) | Mounted on the branch, undocumented | **139** served route keys absent from the document (of 482 mounted; the describer's narrower "described but undocumented" figure is 66) |
| (c) | Mounted on main, not on the branch | **24 documented operations** + 7 undocumented families |

Security drift: **zero**. `changed: 0` — no operation present on both sides
publishes a credential class different from the one its route enforces.

### The hono-openapi traps — checked

- **The served document is the static JSON, not a generated one.**
  `apps/api/src/features/discovery/openapi-document.ts:31` imports
  `./openapi-document.json` and serialises it once; all three publishing routes
  (`api-discovery-rest.ts:37`, `gateway-openapi-rest.ts:33`,
  `root-discovery-rest.ts:85`) share `respondWithApiDocument`
  (`openapi-serve.ts:92`). So neither trap can affect what a customer fetches.
- **Dotted RPC names**: handled. The describer passes `excludeStaticFile: false`
  (`openapi-document.generator.ts:201`), so `/api/organization/latest/organization.getSettings`
  is not dropped as a static file.
- **A second hono-openapi instance is invisible**: handled by construction.
  `composeOpenApiDocumentSurface` routes every family into **one** `Hono`
  (`openapi-document.surface.ts:398-425`) rather than describing each family
  from its own app.

### Two blind spots in the describer (not in the product)

`openapi-document.surface.ts` composes the real
`createApiProcessRestFeatures` enumeration with stand-in collaborators, but it
omits two optional collaborators production supplies, so its route table
under-reports:

1. **`services.agentsV1`** is not in `packagedCollaborators()`
   (`openapi-document.surface.ts:140-176`), so `/api/v1/agents/connect/*` and
   `POST /api/v1/agents/{id}/call` are absent from the described surface and
   land in `removed`. Production **does** mount them:
   `api-packaged-rest.composition.ts:171-173` supplies `agentsV1` whenever
   `connectedAgents` composed, and `app-rest.packaged-families.ts:433-442`
   spreads it into `createAgentV1RestApp`, which registers the routes at
   `packages/features/agent/server/src/transport/api-rest/agent-v1.api.ts:276-292`.
   **Four false positives.**
2. **`ports.auth`** is not in `processPorts()`
   (`openapi-document.surface.ts:295-325`), so the Better Auth family
   (`app-rest.process-features.ts:774-777`) contributes nothing. It publishes no
   `describeRoute`, so no operation is lost — but the served-route table used to
   tell "removed" from "undescribed" is missing that whole prefix.

Fixing both is a change to the describer only, and it would take the guard from
27 regressions to 23.

---

## (a) Documented but not mounted on the branch

`METHOD /path` as the frozen document spells it. "Real" = a client following the
document gets a 404 today.

| Method + path | Real? | File that registers it, or should | Gating condition |
| --- | --- | --- | --- |
| `GET /api/organization` | yes | `packages/features/organization/server/src/transport/api-rest/organization.api.ts:434` (`basePath: "/api/organization"`), mounted at `apps/api/src/app-rest/app-rest.process-features.ts:638-641` | Mounted; only the **bare alias** is gone. `packages/api/src/rest/route-mounting.ts:25` no longer mounts `status: "unversioned"`. Served today only at `/api/organization/2026-08-07/…` and `/api/organization/latest/…` |
| `PATCH /api/organization` | yes | same | same |
| `GET /api/organization/invites` | yes | same | same |
| `POST /api/organization/invites` | yes | same | same |
| `DELETE /api/organization/invites/{id}` | yes | same | same |
| `GET /api/organization/members` | yes | same | same |
| `GET /api/organization/members/{userId}` | yes | same | same |
| `PATCH /api/organization/members/{userId}` | yes | same | same |
| `DELETE /api/organization/members/{userId}` | yes | same | same |
| `GET /api/organization/members/{userId}/access` | yes | same | same |
| `GET /api/roles` | yes | `packages/features/role/server/src/transport/api-rest/role.api.ts:123`, mounted at `apps/api/src/app-rest/app-rest.packaged-families.ts:641-652` | bare alias gone; family itself gated on `services.roles && enterpriseGate("RBAC")` |
| `POST /api/roles` | yes | same | same |
| `GET /api/roles/permissions` | yes | same | same |
| `GET /api/roles/{id}` | yes | same | same |
| `PATCH /api/roles/{id}` | yes | same | same |
| `DELETE /api/roles/{id}` | yes | same | same |
| `GET /api/role-bindings` | yes | `packages/features/authz/server/src/transport/api-rest/role-binding.api.ts:208`, mounted at `apps/api/src/app-rest/app-rest.packaged-families.ts:626-638` | bare alias gone; family gated on `services.permissions && services.authzGrants && enterpriseGate("MANAGEMENT_API")` |
| `POST /api/role-bindings` | yes | same | same |
| `PATCH /api/role-bindings/{id}` | yes | same | same |
| `DELETE /api/role-bindings/{id}` | yes | same | same |
| `GET /api/scim-tokens` | yes | `packages/enterprise/features/scim/server/src/transport/api-rest/scim.api.ts:86`, mounted at `apps/api/src/app-rest/app-rest.packaged-families.ts:685-696` | bare alias gone; family gated on `services.scim && enterpriseGate("SCIM")` |
| `POST /api/scim-tokens` | yes | same | same |
| `DELETE /api/scim-tokens/{id}` | yes | same | same |
| `GET /api/traces/{traceId}/transcript` | yes | `mountTracesRest` leaves it unregistered; the collaborator is `LogService.getLogsByTraceId` over `log_records`, refused by `composeApiTraceReadStack` | In `UNSERVED_AT_BASELINE` (`apps/api/src/tasks/openapi-document/openapi-document.checker.ts:99-121`). Gated on this process composing a canonical **log** read, which it does not — no `@langwatch/log-server` dependency, and `LogRuntimeAdapter` needs a `LogRedactionPort` nothing here supplies |
| `GET /api/v1/agents/connect/poll` | **no** | `packages/features/agent/server/src/transport/api-rest/agent-connect.api.ts:209`, registered from `agent-v1.api.ts:277` | Mounted in production when `ApiConnectedAgentsComposition.tryCompose` succeeds (`apps/api/src/app/api-production.composition.ts:1203-1226`: needs database + Redis + agents). Missing only from the **describer** (`agentsV1` absent from `openapi-document.surface.ts:140`) |
| `POST /api/v1/agents/connect/register` | **no** | `agent-connect.api.ts:164` | same |
| `POST /api/v1/agents/connect/frames` | **no** | `agent-connect.api.ts:256` | same |
| `POST /api/v1/agents/{id}/call` | **no** | `packages/features/agent/server/src/transport/api-rest/agent-call.api.ts:200`, registered from `agent-v1.api.ts:288` | same |
| `GET /` | **no** | nothing — document residue | Baselined. The retired per-family generator emitted the prompt-library list/create bodies at the document root before a base path was applied. No process ever served them |
| `POST /` | **no** | nothing — document residue | same |

One documented operation is mounted but **cannot succeed**:
`POST /api/workflows/{id}/evaluate` registers, and its capability port rejects
by name — `apps/api/src/app/api-packaged-rest.composition.ts:312-313` supplies
`triggerWorkflowEvaluation: () => Promise.reject(new ApiRestCapabilityUnavailableError("workflow evaluation runner"))`.
It is not in table (a) because a route answers; it is a documented operation
that always fails.

Two more are served, carry a `describeRoute`, and are **deliberately dropped**
from any generated document because they authenticate by browser session, which
no published security scheme can express:
`POST /api/export/scenario-runs/download` and `POST /api/workflows/post_event`
(`openapi-document.generator.ts:262-275`). Both are also on main's own
`UNPUBLISHED` list.

---

## (b) Mounted on the branch but undocumented

139 mounted route keys have no entry in the frozen document, out of 482 the
process registers. **Most of this is not drift**: main's own
`platform/app/scripts/openapi-route-exclusions.ts` already declares
`/api/auth`, `/api/health`, `/api/internal`, `/api/langy`, `/api/ingest`,
`/api/otel`, `/api/files`, `/api/github`, `/api/image-proxy`,
`/api/user-avatar`, `/api/bug-reports`, `/api/unsubscribe`, `/api/playground`,
`/api/ops`, `/api/mcp/authorize`, `/api/webhooks/auth0-scim`,
`POST /api/collector`, `GET /api/thread/{id}`, `GET /api/openapi.json`,
`/api/gateway/v1/openapi.json`, `POST /api/experiments/{execute,abort}`,
`/api/dataset/generate`, `/api/scenario/generate` and
`/api/workflows/{code-completion,post_event}` as `internal`, `alias` or
`elsewhere`. Those carried over unchanged.

**The 46 rows that matter** are the versioned management paths — the same
operations table (a) says are missing at their bare paths, now reachable only
under a version segment. They are a *rename*, not new surface:

| Family | Versioned paths served | Bare paths documented |
| --- | --- | --- |
| `/api/organization` | 20 (`/2026-08-07/…` ×10, `/latest/…` ×10) | 10 — all in table (a) |
| `/api/roles` | 12 | 6 — all in table (a) |
| `/api/role-bindings` | 8 | 4 — all in table (a) |
| `/api/scim-tokens` | 6 | 3 — all in table (a) |

The remaining genuinely-undocumented product surface:

| Prefix | Count | Operations | Note |
| --- | --- | --- | --- |
| `/api/secret`, `/api/v1/secret`, `/api/v1/secrets` | 15 | full CRUD ×3 spellings | The document publishes only `/api/secrets` (plural, unversioned), which **is** served. The other three spellings are aliases the document never named. Registered by `ApiSecretRestFeature` (`apps/api/src/api-secret-rest.feature.ts`) and `createSecretLegacyRestApp` (`app-rest.packaged-families.ts:700`) |
| `/api/agents` | 5 | `GET`, `POST`, `GET/PATCH/DELETE /{id}` | The deprecated legacy alias of `/api/v1/agents`; `createAgentLegacyRestApp`, `app-rest.packaged-families.ts:418-425`. Present on main too |
| `/.well-known/openapi/`, `/llms.txt/` | 2 | trailing-slash duplicates | Noise; `root-discovery-rest.ts` registers both spellings |
| `/api/governance/**` under `/api/auth/cli` | 6 | governance CLI reads | New CLI surface, undocumented on main as well |

Full grouped listing:

| Prefix | Count | Operations |
| --- | --- | --- |
| `/.well-known/openapi` | 2 | `GET /.well-known/openapi`<br>`GET /.well-known/openapi/` |
| `/api/agents` | 5 | `DELETE /api/agents/{id}`<br>`GET /api/agents`<br>`GET /api/agents/{id}`<br>`PATCH /api/agents/{id}`<br>`POST /api/agents` |
| `/api/auth` | 20 | `GET /api/auth/cli/bootstrap`<br>`GET /api/auth/cli/budget-overview`<br>`GET /api/auth/cli/budget/status`<br>`GET /api/auth/cli/governance/ingest/sources`<br>`GET /api/auth/cli/governance/ingest/sources/{id}/events`<br>`GET /api/auth/cli/governance/ingest/sources/{id}/health`<br>`GET /api/auth/cli/governance/ingestion-keys`<br>`GET /api/auth/cli/governance/ingestion-templates`<br>`GET /api/auth/cli/governance/status`<br>`GET /api/auth/cli/lookup`<br>`GET /api/auth/cli/personal-project`<br>`POST /api/auth/cli/approve`<br>`POST /api/auth/cli/deny`<br>`POST /api/auth/cli/device-code`<br>`POST /api/auth/cli/exchange`<br>`POST /api/auth/cli/governance/ingestion-key`<br>`POST /api/auth/cli/logout`<br>`POST /api/auth/cli/project-key`<br>`POST /api/auth/cli/refresh`<br>`POST /api/auth/cli/virtual-key` |
| `/api/bug-reports` | 1 | `POST /api/bug-reports` |
| `/api/collector` | 1 | `POST /api/collector` |
| `/api/dataset` | 1 | `POST /api/dataset/generate` |
| `/api/experiments` | 2 | `POST /api/experiments/abort`<br>`POST /api/experiments/execute` |
| `/api/export` | 1 | `POST /api/export/scenario-runs/download` |
| `/api/files` | 4 | `GET /api/files/{id}`<br>`GET /api/files/{projectId}/{id}`<br>`HEAD /api/files/{id}`<br>`HEAD /api/files/{projectId}/{id}` |
| `/api/gateway` | 1 | `GET /api/gateway/v1/openapi.json` |
| `/api/github` | 3 | `GET /api/github/install`<br>`GET /api/github/setup`<br>`POST /api/github/webhook` |
| `/api/github-langy` | 2 | `GET /api/github-langy/setup`<br>`POST /api/github-langy/webhook` |
| `/api/health` | 5 | `GET /api/health/collector`<br>`GET /api/health/evaluations`<br>`GET /api/health/processor`<br>`GET /api/health/triggers`<br>`GET /api/health/workflows` |
| `/api/image-proxy` | 1 | `GET /api/image-proxy` |
| `/api/ingest` | 4 | `POST /api/ingest/otel/{sourceId}`<br>`POST /api/ingest/otel/{sourceId}/v1/logs`<br>`POST /api/ingest/otel/{sourceId}/v1/metrics`<br>`POST /api/ingest/webhook/{sourceId}` |
| `/api/internal` | 3 | `POST /api/internal/langy/credentials/revoke`<br>`POST /api/internal/langy/relay/frames`<br>`POST /api/internal/langy/turn/{turnId}/result` |
| `/api/langy` | 4 | `GET /api/langy/ui/actions`<br>`POST /api/langy/conversations`<br>`POST /api/langy/conversations/{conversationId}/messages`<br>`POST /api/langy/ui/actions` |
| `/api/mcp` | 1 | `POST /api/mcp/authorize` |
| `/api/openapi.json` | 1 | `GET /api/openapi.json` |
| `/api/ops` | 1 | `POST /api/ops/clickhouse/explain` |
| `/api/organization` | 20 | `DELETE /api/organization/2026-08-07/invites/{id}`<br>`DELETE /api/organization/2026-08-07/members/{userId}`<br>`DELETE /api/organization/latest/invites/{id}`<br>`DELETE /api/organization/latest/members/{userId}`<br>`GET /api/organization/2026-08-07/`<br>`GET /api/organization/2026-08-07/invites`<br>`GET /api/organization/2026-08-07/members`<br>`GET /api/organization/2026-08-07/members/{userId}`<br>`GET /api/organization/2026-08-07/members/{userId}/access`<br>`GET /api/organization/latest/`<br>`GET /api/organization/latest/invites`<br>`GET /api/organization/latest/members`<br>`GET /api/organization/latest/members/{userId}`<br>`GET /api/organization/latest/members/{userId}/access`<br>`PATCH /api/organization/2026-08-07/`<br>`PATCH /api/organization/2026-08-07/members/{userId}`<br>`PATCH /api/organization/latest/`<br>`PATCH /api/organization/latest/members/{userId}`<br>`POST /api/organization/2026-08-07/invites`<br>`POST /api/organization/latest/invites` |
| `/api/otel` | 3 | `POST /api/otel/v1/logs`<br>`POST /api/otel/v1/metrics`<br>`POST /api/otel/v1/traces` |
| `/api/playground` | 1 | `POST /api/playground` |
| `/api/role-bindings` | 8 | `DELETE /api/role-bindings/2026-08-07/{id}`<br>`DELETE /api/role-bindings/latest/{id}`<br>`GET /api/role-bindings/2026-08-07/`<br>`GET /api/role-bindings/latest/`<br>`PATCH /api/role-bindings/2026-08-07/{id}`<br>`PATCH /api/role-bindings/latest/{id}`<br>`POST /api/role-bindings/2026-08-07/`<br>`POST /api/role-bindings/latest/` |
| `/api/roles` | 12 | `DELETE /api/roles/2026-08-07/{id}`<br>`DELETE /api/roles/latest/{id}`<br>`GET /api/roles/2026-08-07/`<br>`GET /api/roles/2026-08-07/permissions`<br>`GET /api/roles/2026-08-07/{id}`<br>`GET /api/roles/latest/`<br>`GET /api/roles/latest/permissions`<br>`GET /api/roles/latest/{id}`<br>`PATCH /api/roles/2026-08-07/{id}`<br>`PATCH /api/roles/latest/{id}`<br>`POST /api/roles/2026-08-07/`<br>`POST /api/roles/latest/` |
| `/api/rum` | 1 | `POST /api/rum/v1/traces` |
| `/api/scenario` | 1 | `POST /api/scenario/generate` |
| `/api/scim-tokens` | 6 | `DELETE /api/scim-tokens/2026-08-07/{id}`<br>`DELETE /api/scim-tokens/latest/{id}`<br>`GET /api/scim-tokens/2026-08-07/`<br>`GET /api/scim-tokens/latest/`<br>`POST /api/scim-tokens/2026-08-07/`<br>`POST /api/scim-tokens/latest/` |
| `/api/secret` | 5 | `DELETE /api/secret/{id}`<br>`GET /api/secret`<br>`GET /api/secret/{id}`<br>`POST /api/secret`<br>`PUT /api/secret/{id}` |
| `/api/thread` | 1 | `GET /api/thread/{id}` |
| `/api/unsubscribe` | 1 | `POST /api/unsubscribe` |
| `/api/user-avatar` | 2 | `GET /api/user-avatar/{projectId}/{id}`<br>`HEAD /api/user-avatar/{projectId}/{id}` |
| `/api/v1` | 10 | `DELETE /api/v1/secret/{id}`<br>`DELETE /api/v1/secrets/{id}`<br>`GET /api/v1/secret`<br>`GET /api/v1/secret/{id}`<br>`GET /api/v1/secrets`<br>`GET /api/v1/secrets/{id}`<br>`POST /api/v1/secret`<br>`POST /api/v1/secrets`<br>`PUT /api/v1/secret/{id}`<br>`PUT /api/v1/secrets/{id}` |
| `/api/webhooks` | 1 | `POST /api/webhooks/auth0-scim` |
| `/api/workflows` | 2 | `POST /api/workflows/code-completion`<br>`POST /api/workflows/post_event` |
| `/llms.txt` | 2 | `GET /llms.txt`<br>`GET /llms.txt/` |

---

## (c) Mounted on main but not on the branch

### Documented operations (24)

| Method + path | main file:line | Branch file:line that should mount it | Gating condition |
| --- | --- | --- | --- |
| `GET/PATCH /api/organization`, `GET/POST /api/organization/invites`, `DELETE /api/organization/invites/{id}`, `GET /api/organization/members`, `GET/PATCH/DELETE /api/organization/members/{userId}`, `GET /api/organization/members/{userId}/access` (10) | `platform/app/src/app/api/organization/[[...route]]/app.ts` over `platform/app/src/server/api/management/managed-service.ts:60`, bare alias mounted by `packages/api/src/route-mounting.ts:70-82` | `packages/api/src/rest/route-mounting.ts:25` (`mountResolvedRoutes`) — reinstate the unversioned mount, or accept ADR-002 and reissue the document | ADR-002 removed the bare alias unconditionally. No runtime condition |
| `GET/POST /api/roles`, `GET /api/roles/permissions`, `GET/PATCH/DELETE /api/roles/{id}` (6) | `platform/app/src/app/api/roles/[[...route]]/…` | same | same |
| `GET/POST /api/role-bindings`, `PATCH/DELETE /api/role-bindings/{id}` (4) | `platform/app/src/app/api/role-bindings/[[...route]]/…` | same | same |
| `GET/POST /api/scim-tokens`, `DELETE /api/scim-tokens/{id}` (3) | `platform/app/src/app/api/scim-tokens/[[...route]]/…` | same | same |
| `GET /api/traces/{traceId}/transcript` (1) | `platform/app/src/app/api/traces/[[...route]]/app.v1.ts:314-386` | `mountTracesRest` in `apps/api/src/app-rest/app-rest.process-features.ts` (trace read stack) | Needs a composed canonical `LogService` over `log_records`. `composeApiTraceReadStack` refuses by name; this process composes no log signal |

Main's `platform/app/src/app/api/organization/[[...route]]/app.ts:10-11` states the
old contract in as many words: "Only the bare alias paths reach the OpenAPI
document; the dated and `latest` mounts serve traffic with version headers."

### Undocumented families main served and the branch does not (7)

Not an OpenAPI-parity problem — none of these appears in either document — but
they are the rest of the REST delta and are listed for completeness. Confirmed
absent from the branch's 482-route table.

| Family | main file:line | Branch file:line | Gating condition |
| --- | --- | --- | --- |
| `POST /api/export/traces/download` | `platform/app/src/server/api-router.ts:144` → `app/api/export/traces/[[...route]]/app.ts` | `packages/features/trace/server/src/transport/api-rest/trace-export.api.ts:102` (`createExportTracesRestApp`) | Built, never mounted; only re-exported from `apps/api/src/index.ts` |
| `/api/admin/*` | `platform/app/src/server/api-router.ts:208` → `platform/app/ee/admin/routes/admin.ts:43` | `packages/features/ops/server/src/transport/api-rest/admin.api.ts:111` (`createAdminRestApp`) | Built, zero references in `apps/` |
| `POST /api/webhooks/stripe` | `platform/app/src/server/routes/misc.ts:1534` | `packages/enterprise/features/billing/server/src/transport/api-rest/stripe-webhook.api.ts:48` | Built, zero references in `apps/` |
| `/api/cron/*` (3 routes) | `platform/app/src/server/routes/cron.ts:74,77,80` | none | No `/api/cron` family exists on the branch |
| `POST /api/track_usage` | `platform/app/src/server/routes/misc.ts:1288` | none | Receiver absent; the sender in `packages/features/ops/server` is itself uninstalled |
| `POST /api/demo/hotel_bot` | `platform/app/src/server/routes/misc.ts:313` | none | Demo fixture |
| `/api/copilotkit` | `platform/app/src/server/api-router.ts:125` | `apps/api/src/app-rest/app-rest.packaged-families.ts` — `report.absent("copilotkit")` | Deliberate, reported at boot, bound by `specs/prompts/playground-chat-availability.feature` |

---

## Where `dev/docs/plans/unmounted-surfaces-audit-2026-09-04.md` was wrong

That audit was right about the tRPC, worker and UI surfaces, and right about the
seven undocumented families above. Its REST/OpenAPI section has three errors:

1. **The headline claim is false.** §1 says: "The frozen document
   `apps/api/src/features/discovery/openapi-document.json` publishes 190 paths
   across 45 first-segment families; **every one of them has a mount on the
   branch** except `/api/optimization/{workflowId}/{versionId}`'s sibling
   evaluate route." Twenty-four documented operations across four first-segment
   families (`/api/organization`, `/api/roles`, `/api/role-bindings`,
   `/api/scim-tokens`) plus `/api/traces/{traceId}/transcript` have no route at
   their documented path. The audit compared at **family** granularity and so
   could not see a family that is mounted at a different URL than the one the
   document publishes. Path-and-method granularity is the only granularity that
   answers this question.
2. **It missed the bare-alias removal entirely.** ADR-002
   (`packages/api/adrs/002-explicit-version-namespaces.md`) is the largest
   customer-visible REST behaviour change between main and the branch, and it
   does not appear anywhere in that audit. It is invisible to a
   registration-site diff, because both sides *have* the registration — main's
   `packages/api/src/route-mounting.ts:70-82` mounts it three times (dated,
   `latest`, bare) and the branch's mounts it twice.
3. **It reported no drift check.** The repository already owns a task and a test
   that answer this question mechanically — `pnpm --filter
   @langwatch/platform-api run task openapi-check` and
   `apps/api/src/tasks/openapi-document/__tests__/openapi-document.unit.test.ts`
   — and both are **red on the branch**. An audit of what the process mounts
   that does not run the repo's own mount-derived describer is doing by hand
   what a red test already says.

Its §1 caveat about the Better Auth family is now stale: `/api/auth/*` is
committed and mounted (`apps/api/src/app-rest/app-rest.process-features.ts:774-777`,
supplied from `apps/api/src/app/api-production.composition.ts:1841`), and 20
`/api/auth/cli/*` routes appear in the mounted route table.

---

## Method

- Documents enumerated with a JSON walk over `paths` × HTTP methods: 298
  operations, 190 paths, both files, byte-identical.
- Mounted surface enumerated **without booting the app**, by calling
  `generateOpenApiDocument` from
  `apps/api/src/tasks/openapi-document/openapi-document.generator.ts`. It
  composes the process's real `createApiProcessRestFeatures` enumeration with
  refusing stand-ins (`openapi-document.surface.ts`), walks the resulting Hono
  route table and the `describeRoute` metadata, and invokes no handler. Raw
  output: 482 mounted route keys, 323 described operations.
- Main's surface read from `git show origin/main:<path>` — `platform/app/src/server/api-router.ts`,
  the `platform/app/src/app/api/**/[[...route]]/` apps, and
  `packages/api/src/route-mounting.ts`.
- Conditional mounts traced through `apps/api/src/app/api-production.composition.ts`
  and `apps/api/src/app/api-packaged-rest.composition.ts` to their gating
  collaborator.
