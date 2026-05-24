# Governance — Agentic-First Parity (v1 status)

> Lane-S audit deliverable per ralph-loop re-verification 2026-05-08. Anchors
> the v1 scope-fence on shipped SHAs + service file paths so reviewers know
> exactly which governance resources have full agentic-first parity (tRPC +
> Hono REST + CLI + MCP) and which are deferred to follow-on work.
>
> Joins on `resource` with the broader feature × persona × proof-type matrix
> (Lane-B) and the real-user dogfood gap report (Lane-Q).

## Per-resource × per-surface coverage matrix

Legend: 🟢 shipped + tested · 🟡 shipped tRPC-only (UI-functional, agent-blocked) · ⚪ tracked v1.1+ deferral · 🔵 lives at non-`/api/governance` REST namespace · ❌ no service yet

| Resource | Service file | tRPC | Hono REST | CLI | MCP | v1 status |
|---|---|---|---|---|---|---|
| `ingestion-templates` | `ee/governance/services/ingestionTemplate.service.ts` | 🟢 `ee/governance/routers/ingestionTemplates.ts` | 🟢 `/api/governance/ingestion-templates` (`0bb951160`) | 🟢 `langwatch governance ingestion-templates` (`ed51b0ea1`) | 🟢 `governance_ingestion_templates_*` (7 verbs, `7639b6c2b`) | **FULL PARITY** |
| `user-ingestion-bindings` | `ee/governance/services/userIngestionBinding.service.ts` | 🟢 `ee/governance/routers/userIngestionBindings.ts` | 🟢 `/api/governance/user-ingestion-bindings` (`5275e7e11`) | 🟢 `langwatch governance user-ingestion-bindings` (`ed51b0ea1`) | 🟢 `governance_user_ingestion_bindings_*` (4 verbs, `7639b6c2b`) | **FULL PARITY** |
| `routing-policies` | `ee/governance/services/routingPolicy.service.ts` | 🟢 (router referenced from `governance.ts`) | 🟡 — | 🟡 — | 🟡 — | tRPC-only; agent-blocked |
| `anomaly-rules` | `ee/governance/services/activity-monitor/anomalyRule.service.ts` | 🟢 `ee/governance/routers/anomalyRules.ts` | 🟡 — | 🟡 — | 🟡 — | tRPC-only; agent-blocked |
| `ai-tool-entries` | `ee/governance/services/aiToolEntry.service.ts` | 🟢 `ee/governance/routers/aiTools.ts` | 🟡 — | 🟡 — | 🟡 — | tRPC-only; agent-blocked |
| `ingestion-sources` | `ee/governance/services/activity-monitor/*` | 🟢 `ee/governance/routers/ingestionSources.ts` | 🟡 — | 🟡 — | 🟡 — | tRPC-only; agent-blocked |
| `cli-sessions` (per-user) | `ee/governance/services/cliSessionInventory.service.ts` | 🟢 `ee/governance/routers/personalSessions.ts` | 🟡 — | 🟡 — | 🟡 — | tRPC-only; agent-blocked |
| `session-policy` (max duration per org) | implied via `personalSessions` shape | 🟢 `ee/governance/routers/sessionPolicy.ts` | 🟡 — | 🟡 — | 🟡 — | tRPC-only; agent-blocked |
| `virtual-keys` | `langwatch/src/server/gateway/virtualKey.service.ts` | 🟢 (existing tRPC) | 🔵 `/api/gateway/v1/virtual-keys` (PR #3168) | 🔵 `langwatch gateway-providers` (existing) | 🟡 — | non-`/api/governance` REST already; MCP gap |
| `gateway-budgets` | `langwatch/src/server/gateway/budget.service.ts` | 🟢 (existing tRPC) | 🔵 `/api/gateway/v1/budgets` | 🔵 `langwatch gateway-budgets` | 🟡 — | non-`/api/governance` REST already; MCP gap |
| `role-bindings` | `langwatch/src/server/rbac/role-binding-resolver.ts` | 🟢 (existing) | 🟡 — | 🟡 — | 🟡 — | tRPC-only; agent-blocked |
| `audit-log` (read) | `langwatch/src/server/api/routers/auditLog.ts` (or equivalent) | 🟢 (existing) | 🟡 — | 🟡 — | 🟡 — | tRPC-only; agent-blocked |

**Score**: 2/12 governance resources have **FULL** four-surface agentic-first parity in v1. 8/12 are tRPC-only. 2/12 (`virtual-keys` + `gateway-budgets`) live at `/api/gateway/v1/*` rather than `/api/governance/*` and have CLI but no MCP.

## v1 scope-fence rationale

Per umbrella spec `governance-api-cli-mcp-coverage.feature` (commit
`3d6ecaae8`), the long-form contract enumerates 12 governance resources
that should each carry the `list/get/create/update/delete` verb set
across all four surfaces with shared service-layer dispatch, OpenAPI
auto-gen, audit attribution via `metadata.surface`, and CI-enforced
@no-bypass invariant.

**v1 ships the load-bearing two**: `ingestion-templates` and
`user-ingestion-bindings`. These are the resources where agentic-first
parity is genuinely needed *today* per rchaves's "company governance
over Claude Code 20x usage" framing — admins fork OTTL templates,
users install bindings, all four surfaces (dashboard / REST / CLI /
agent-tooling) are exercisable end-to-end.

**The remaining 10 resources are NOT shipped at full parity in v1
because**:

1. **Service-layer prerequisites differ**. Some services already use
   the repository pattern (`virtualKey.service.ts`, `budget.service.ts`)
   from the gateway-platform PR (#3168), so a Hono port is mostly a
   route-file write. Others (`anomalyRule.service.ts`,
   `aiToolEntry.service.ts`, `routingPolicy.service.ts`) still call
   prisma directly; a Hono port should NOT precede the repository-
   pattern extraction or it bakes in the @no-bypass violation.

2. **Audit-surface threading not done**. Services that emit audit
   rows but don't accept the `surface: GovernanceCallSurface` parameter
   (`anomalyRule`, `aiToolEntry`, `routingPolicy`, `cliSessionInventory`,
   `aiTools`) need the same thread-through that Lane-S shipped at
   `fc6d54100` for ingestion-templates+bindings. Without it, surface
   attribution silently defaults to `"trpc"` regardless of caller.

3. **No agent-blocking customer report**. The "Claude Code 20x company
   governance" use case maps to ingestion-templates + bindings
   specifically — the OTTL fork-and-customize flow + per-user ik-lw-
   token install. The other 10 resources are admin-internal (governance
   admin sets policy, users don't poke at it). Agent-driven CRUD via
   MCP is high-value for the user-flow resources, low-value for the
   admin-only resources. The umbrella spec's @resource-coverage scenario
   is forward-looking; the v1 cut takes the user-flow pair.

## Minimum viable lift per gap cell (follow-on PRs)

Each row below estimates the lift to bring a resource to full four-
surface parity, assuming the resource's tRPC router already exists.
Numbers are approximate per-resource costs based on the
ingestion-templates path (which took ~9 SHAs). See "Pre-flight
checklist" below for the gates.

| Resource | Pre-flight | Hono port (LOC est) | CLI commands | MCP tools | Repo-pattern lift | Total est PRs |
|---|---|---|---|---|---|---|
| `routing-policies` | ✅ service exists | ~250 | ~150 | ~120 | required (uses `prisma` directly) | 1 medium PR |
| `anomaly-rules` | ✅ service exists | ~300 (CRUD + threshold subset) | ~180 | ~140 | required | 1 medium PR |
| `ai-tool-entries` | ✅ service exists | ~280 | ~160 | ~130 | required | 1 medium PR |
| `ingestion-sources` | ✅ service exists | ~320 (mint-token + pull-config) | ~190 | ~150 | required | 1 medium PR |
| `cli-sessions` | ✅ service exists | ~180 (read-mostly) | ~120 | ~100 | optional (read-only path) | 1 small PR |
| `session-policy` | ✅ service exists | ~150 (single-row-per-org) | ~80 | ~70 | optional | 1 small PR |
| `virtual-keys` | ✅ at `/api/gateway/v1` | n/a (already shipped) | n/a (already shipped) | ~150 (mirror existing REST) | already done | 1 small MCP-only PR |
| `gateway-budgets` | ✅ at `/api/gateway/v1` | n/a (already shipped) | n/a (already shipped) | ~140 | already done | 1 small MCP-only PR |
| `role-bindings` | tRPC exists | ~280 (3-principal-type input shape) | ~180 | ~150 | required | 1 medium PR |
| `audit-log` (read) | tRPC exists | ~120 (paginated read) | ~80 | ~80 | n/a | 1 small read-only PR |

Total: **8-10 follow-on PRs** to bring all 12 resources to v1.x full
parity. Each PR is a self-contained `<resource>` slice that mirrors
the ingestion-templates pattern verbatim (service-layer-shared,
repository-pattern, surface attribution, `/api/governance/<resource>`
basePath, snake_case wire, audit-uniform contract).

### Pre-flight checklist (per follow-on resource PR)

For each resource, do these in order before opening the route file:

1. **Repository-pattern extraction** (skip if service already uses it).
   Pattern: see `ee/governance/repositories/ingestionTemplate.repository.ts`
   + `userIngestionBinding.repository.ts`. Service constructor accepts
   the repo via DI, methods take `Prisma.TransactionClient | PrismaClient`
   per call so they work both inside and outside `$transaction` blocks.

2. **Audit `surface` thread-through**. Add optional
   `surface?: GovernanceCallSurface` to every mutating service method,
   stamp `metadata.surface = surface ?? DEFAULT_GOVERNANCE_SURFACE`
   into every `auditRepo.emit(...)` call. Pattern: see `fc6d54100`.

3. **tRPC caller updates**. Every existing tRPC procedure passes
   `surface: "trpc"` explicitly so the audit-attribution column is
   populated correctly (the default fallback exists for back-compat
   but explicit-is-better-than-implicit on the hot path).

4. **Hono route file**. Mirror `langwatch/src/app/api/governance/[[...route]]/app.ts`
   structure: snake_case Zod schemas, snake_case wire, `requirePatPermission`
   per route, `resolveSurfaceFromRequest` for CLI surface attribution
   on Hono mutations, `mapServiceError` helper for service→HTTP code mapping.

5. **CLI commands**. Mirror `typescript-sdk/src/cli/commands/governance/ingestion-templates.ts`
   + `user-ingestion-bindings.ts` + add to the subcommand tree in
   `typescript-sdk/src/cli/index.ts`. Commands are always available
   once the CLI is installed; per-account entitlement is enforced
   server-side. Use `requestREST` from `cli/utils/governance/cli-api.ts`
   so `X-LangWatch-Surface: cli` is sent automatically.

6. **MCP tools**. Mirror `src/mcp/governance-tools.ts`
   `governance_<resource>_<verb>` registration. Read tools allowed for
   project-apiKey-only sessions; write tools gate on `ctx.callerUserId`
   from OAuth + `hasOrganizationPermission` check BEFORE service call.

7. **Tests**. REST integration test (mirror
   `governance-rest-api.integration.test.ts` for legacy-token routes
   or `governance-bindings-rest-api.integration.test.ts` for PAT-gated).
   MCP audit-uniform regression (mirror `governance-tools.audit-uniform.integration.test.ts`).
   Cross-surface uniformity case (extend
   `auditSurface.crossSurface.integration.test.ts` with the new
   resource's `create` verb).

8. **No-bypass coverage**. The CI test at
   `ee/governance/repositories/__tests__/no-bypass.unit.test.ts`
   currently grep-asserts only the two v1 governance tables. When
   adding a new repo, extend `GATED_TABLE_PATTERNS` with the new
   table name so future drift is caught.

## v1.1+ deferred work (explicitly out of scope per umbrella spec)

| Item | Reason for deferral | Reference |
|---|---|---|
| 16-key B6 attribution restamp on binding-routed traces | v1 closes 5-key bindingProvenance no-spy gate; 16-key principal-field guard for binding traces is separate forge-defense surface | `eabfb84d6` no-spy v1 scope-fence |
| pnpm SDK regen script names | Minor TBD-IMPL pending the regen target SHA | `docs/ai-governance/api.mdx` |
| Hono routes for the 10 governance resources beyond ingestion-templates+bindings | Requires repo-pattern extraction + audit-surface threading per resource; ships as 8-10 follow-on PRs per the matrix above | this doc |

## Cross-surface uniformity proven for v1 resources

The four-surface uniformity invariant from umbrella spec @audit-uniform
is proven for the v1 pair via:

- **Cross-surface comparison test**: `ee/governance/services/__tests__/auditSurface.crossSurface.integration.test.ts`
  invokes `createOrgTemplate` via tRPC + Hono + CLI + MCP service-direct
  in one run, asserts identical AuditLog payload shape modulo
  `metadata.surface`. Includes spoof-rejection regression (3 cases).
- **Single-surface MCP regression**: `src/mcp/__tests__/governance-tools.audit-uniform.integration.test.ts`
  asserts surface=mcp on 2 mutating tools + AUTH_REQUIRED fail-closed.
- **REST integration coverage**: 14-scenario ingestion-templates +
  9-scenario PAT-gated bindings (locks human_caller_required + token
  rotation audit + cross-org NOT_FOUND).
- **No-bypass CI lock**: `ee/governance/repositories/__tests__/no-bypass.unit.test.ts`
  fails the build if any future PR introduces a direct
  `prisma.<gated-table>.<method>(` call outside the allowlist.

When follow-on PRs land each remaining resource, the cross-surface
uniformity test extends with a `<resource>.<create-verb>` case per
resource, the no-bypass regex extends with the resource's table, and
the audit-uniform invariant remains CI-enforced.
