# Module wiring audit

Answers: "which modules are not properly linked up — internally or
externally?" Read from `modules/catalogue.json` outward against the generated
lists (`modules/server-modules.generated.ts`, `modules/web-modules.generated.ts`),
never from directory listings. 54 catalogue entries audited (47 core + 7
enterprise), all appear in the table below. Read-only sweep; nothing here was
fixed.

Excluded from findings by design: `*.config.ts` compile failures. The tree is
mid-migration onto rebuilt `@langwatch/config`/`@langwatch/secrets` and ~26
modules are being ported by other lanes right now — that is expected and not
reported here.

Two independent corroborations were checked for every finding below: the live
tree (imports, generated lists) and, where one exists, the
architecture-enforcer's own `feature-shape-baseline.json` (whole-tree policy
debt already on record). Findings are marked **tracked** when the baseline
already carries the key, and **new** when it does not — Alex should read the
**new** ones as news.

## Findings, ranked

### 1. `billing` — full backend half built, never installed (tracked: `billing|no-app`, `billing|installer-not-booted`, `billing|contract-service`)

`enterprise/modules/billing/process/src/billing.server.ts` never calls
`defineServerModule(...).withApp(...)` — it has no `.withApp(` anywhere in the
file (verified: it is the only `*.server.ts` in the whole tree, core or
enterprise, missing that call). It exports loose factory functions instead
(`createBillableEventsQuery`, `createStripeUsageReporting`, …,
`enterprise/modules/billing/process/src/billing.server.ts:37-100`). Consequently:

- `modules/server-modules.generated.ts:56-105` has no `billingServer` — billing
  is the only catalogue entry with a `process/` package absent from the
  installed server chain (`billingServer` does not exist as a symbol anywhere).
- Its three transports — `billingStripeWebhookRest`, `currencyTrpcTransport`,
  `subscriptionTrpcTransport` (`enterprise/modules/billing/process/src/index.ts:6-20`)
  — are imported nowhere outside the package itself; grepped repo-wide for
  `currencyTrpcTransport`, `subscriptionTrpcTransport`,
  `billingStripeWebhookRest` in `apps/` → zero hits.
- Its worker eventing (`BillableEventsMeterProjection`,
  `BillingMeterDispatchSubscriber`) is likewise never registered by
  `apps/worker`.
- Meanwhile `billingWeb` **is** installed and shipped:
  `modules/web-modules.generated.ts:11,51` lists it, and
  `enterprise/modules/billing/browser/src/billing.web.ts:9` declares
  `defineWebModule("billing").withScreens({...})`. The billing screens render
  and call `BillingSubscriptionApi`/`BillingCurrencyApi` (declared in
  `enterprise/modules/billing/browser/src/behavior/billing-api.ts`) against a
  server that mounts none of it.

Severity: high — a customer-facing screen is live with no backend behind any
of its calls. Already tracked as debt (three baseline keys), not news, but it
is the most consequential single gap in the sweep.

### 2. `AuditLogApi` has zero installed providers — 5 modules boot with an unresolved required peer (tracked as `audit-log|installer-not-booted`, but the *cause* below is new)

`modules/catalogue.json:404-409` lists exactly one `audit-log` entry, rooted at
`modules/audit-log` — contract-only (`contract/`, `specs/`, `adrs/`, no
`process/`, no `browser/`). A full, working implementation of `AuditLogApi`
exists at `enterprise/modules/audit-log/process/src/app/audit-log.app.ts`
(package `@langwatch/enterprise-audit-log-process`) — but **this directory has
no catalogue entry at all**: grepped the whole tree for
`enterprise-audit-log-process` outside its own folder → the only hit is a
fixture in `packages/architecture-enforcer/tests/prisma-migration-access.unit.test.ts`,
i.e. test data, not real installation.

The only other thing implementing `AuditLogApiContract` is
`packages/audit-log-null/src/null-audit-log.app.ts` (`NullAuditLog`), and
nothing outside its own tests imports it either (`grep -rln "NullAuditLog"` →
no hits in `apps/`).

Five installed modules declare `auditLog: AuditLogApi` as a **required**
dependency:
- `modules/agent/process/src/app/agent.app.ts:94,96`
- `modules/automation/process/src/app/automation.app.ts:258,264`
- `modules/evaluator/process/src/app/evaluator.app.ts:120,124`
- `enterprise/modules/scim/process/src/app/scim.app.ts:103,109`
- `enterprise/modules/sso/process/src/app/sso.app.ts:82,86`

None of these five can resolve that peer from the installed graph in
`modules/server-modules.generated.ts`. The architecture-enforcer baseline
already carries `audit-log|installer-not-booted` (in
`packages/architecture-enforcer/src/feature-shape-baseline.json`), which is
the generic "this module boots no app" shape check — but it does not know a
working implementation is sitting one catalogue entry away. The fix is a
one-line catalogue addition, not a rebuild.

Severity: high — this is a required peer (audit trail for SSO/SCIM identity
changes and agent/automation/evaluator actions), not an optional one.

### 3. `hosted-mcp` — a declared, tested REST route is never mounted (new, not in any baseline)

`modules/hosted-mcp/process/src/hosted-mcp.server.ts:6` is exactly:
`defineServerModule("hosted-mcp").withApp(HostedMcpApp).build()` — no
`.withTransports(...)` call at all, the only place in the codebase (besides
billing, already covered) where a module with a non-empty `transport/`
directory has zero mounted transports.

`modules/hosted-mcp/process/src/transport/mcp-authorize.rest.ts:89` declares
`export const mcpAuthorizeRest = defineRestRouter(McpAuthorizeApi)...` — the
approval step of the hosted-MCP OAuth flow
(`@see specs/security/hosted-mcp-grant-fidelity.feature`, line 3 of the same
file). It is re-exported from `modules/hosted-mcp/process/src/index.ts:29`,
and grepped repo-wide for `mcpAuthorizeRest` outside `modules/hosted-mcp/` →
only its own unit/integration tests reference it (which call the router
object directly, not through a mounted app). `POST /api/mcp/authorize` does
not exist in the running server.

This key does not appear in `feature-shape-baseline.json` under `hosted-mcp|*`
— it is not currently tracked anywhere. Severity: high — it is a security
consent-approval endpoint with passing unit tests that never see production
traffic, the exact shape of bug a green test suite hides.

### 4. `saas` — browser package built, wired nowhere, no backend at all (new)

`enterprise/modules/saas` has `contract/` + `browser/` only, no `process/`.
Its contract (`enterprise/modules/saas/contract/src/index.ts`) declares no
`moduleApi<>()` token — it is config-only (`saas.config.ts`), consumed by
`apps/worker/src/config.ts` and `apps/ui/src/behavior/ui-feature-config.ts` for
the SaaS classification flag alone.

Its browser package has no `defineWebModule`/`defineBrowserModule` call
anywhere (`grep -rl "defineBrowserModule" enterprise/modules/saas/browser/src`
→ empty) and is absent from `modules/web-modules.generated.ts` (no `saasWeb`
import). Its two exports
(`enterprise/modules/saas/browser/src/index.ts:1-2`,
`extra-footer-components.tsx` and `saas-browser-analytics.ts`) are imported
nowhere outside the package itself — grepped repo-wide for
`enterprise-saas-browser` → zero hits outside its own folder. This is dead
code, not a wired-but-broken feature.

### 5. `managed-provider` — browser package built, zero consumers (new)

Backend is fully wired (`managedProviderServer` is in
`modules/server-modules.generated.ts:82`). Its browser package
(`@langwatch/enterprise-managed-provider-browser`) has no
`defineBrowserModule` call and is absent from
`modules/web-modules.generated.ts`; grepped repo-wide for
`enterprise-managed-provider-browser` → zero hits outside its own folder.
Lower severity than #4 — the backend capability works, only its UI is dead.

### 6. `langy-browser` and `suite-browser` shared outside the kit law (new, structural)

Neither package declares a `defineBrowserModule`/`defineWebModule` (correctly
absent from `modules/web-modules.generated.ts` — they own no screen), but both
are imported directly by other modules' private browser code via ad hoc
subpath exports in their own `package.json` `exports` map (e.g.
`@langwatch/langy-browser/surfaces/langy-store`,
`@langwatch/suite-browser/suite-form`) rather than through a `*-browser-kit`
package. `langy-browser` is imported this way from at least
`modules/trace/browser`, `modules/project/browser`, `modules/experiment/browser`,
`modules/scenario/browser`, `modules/model-provider/browser`,
`modules/workflow/browser`, `modules/prompt/browser` and
`enterprise/modules/governance/browser` (grep count: 8+ consuming modules,
well past the kit law's three-consumer threshold in `dev/docs/ARCHITECTURE.md`).
`suite-browser` is imported the same way from `modules/scenario/browser` and
`modules/trace/browser`. This is the boundary the "kit law" exists to close —
worth a `langy-browser-kit`/`suite-browser-kit` extraction, not a rename.

### Lower-tier, already tracked — not re-reported as news

`packages/architecture-enforcer/src/feature-shape-baseline.json` already
carries `unregistered-channels` for `auth`, `automation`, `github`,
`notification`, `workflow` and `langy` (channel implementations exist under
`channels/http/`, `channels/slack/`, etc. with no
`channels/<feature>-channels.registry.ts` pairing a `memory/` twin — e.g.
`modules/auth/process/src/channels/better-auth.channel.ts` has no
`channels/memory/` directory at all). These are real internal-wiring gaps per
the manifest's channel/memory-twin check, but they are pre-existing, ratcheted
debt the enforcer already tracks — listed here for completeness, not counted
among the ranked findings above.

## Per-module table

catalogued is `yes` for every row (sourced from `modules/catalogue.json`); the
column is kept to show the check was made against the file, not skipped.

| module | catalogued | Api provided | transports mounted | browser declared | peers resolvable | verdict |
|---|---|---|---|---|---|---|
| agent | yes | yes | yes | yes | **no — AuditLogApi unresolved** | FINDING (peer) |
| analytics | yes | yes | yes | yes | yes | wired |
| annotation | yes | yes | yes | N/A (no browser) | yes | wired |
| api-key | yes | yes | yes | yes | yes | wired |
| auth | yes | yes | yes | yes | yes | wired (tracked channel debt) |
| authz | yes | yes | yes | yes | yes | wired |
| automation | yes | yes | yes | yes | **no — AuditLogApi unresolved** | FINDING (peer) |
| coding-agent | yes | yes | yes | yes | yes | wired |
| dashboard | yes | yes | yes | N/A (no browser pkg) | yes | wired |
| data-privacy | yes | yes | yes | yes | yes | wired |
| data-retention | yes | yes | yes | yes | yes | wired |
| dataset | yes | yes | yes | yes | yes | wired |
| entitlement | yes | yes | yes | N/A (no browser) | yes | wired |
| evaluation | yes | yes | yes | N/A (no browser) | yes | wired |
| evaluator | yes | yes | yes | yes | **no — AuditLogApi unresolved** | FINDING (peer) |
| experiment | yes | yes | yes | yes | yes | wired |
| feature-flag | yes | yes | yes | yes | yes | wired |
| gateway | yes | yes | yes | yes | yes | wired |
| github | yes | yes | yes | yes | yes | wired (tracked channel debt) |
| hosted-mcp | yes | yes | **no — declared, unmounted** | N/A (no browser) | yes | **FINDING** |
| identity | yes | yes | yes (no transports needed) | N/A (no browser) | yes | wired |
| langy | yes | yes | yes | **N/A by design, but shared outside kit law** | yes | FINDING (kit law) |
| log | yes | yes | yes (no transports needed) | N/A (no browser) | yes | wired |
| metric | yes | yes | yes (no transports needed) | N/A (no browser) | yes | wired |
| model-provider | yes | yes | yes | yes | yes | wired |
| monitor | yes | yes | yes | yes | yes | wired |
| navigation | yes | N/A (browser-only) | N/A | yes | N/A | wired |
| notification | yes | yes | yes (no transports needed) | yes | yes | wired (tracked channel debt) |
| onboarding | yes | N/A (browser-only) | N/A | yes | N/A | wired |
| ops | yes | yes | yes | yes | yes | wired |
| organization | yes | yes | yes | yes | yes | wired |
| platform-health | yes | yes | yes | N/A (no browser) | yes | wired |
| presence | yes | yes | yes | yes | yes | wired |
| project | yes | yes | yes | yes | yes | wired |
| prompt | yes | yes | yes | yes | yes | wired |
| role | yes | yes | yes | N/A (no browser) | yes | wired |
| scenario | yes | yes | yes | yes | yes | wired |
| secret | yes | yes | yes | yes | yes | wired |
| share | yes | yes | yes | yes | yes | wired |
| stored-object | yes | yes | yes | N/A (no browser) | yes | wired |
| suite | yes | yes | yes | **N/A by design, but shared outside kit law** | yes | FINDING (kit law) |
| topic | yes | yes | yes | yes | yes | wired |
| trace | yes | yes | yes | yes | yes | wired |
| user | yes | yes | yes | yes | yes | wired |
| webhook | yes | yes | yes | N/A (no browser) | yes | wired |
| workflow | yes | yes | yes | yes | yes | wired (tracked channel debt) |
| audit-log (core) | yes | yes (token only) | N/A (no process) | N/A | N/A | **FINDING — real impl exists uncatalogued, see #2** |
| billing | yes | **no Api, no app** | **no — nothing mounted** | yes (browser only) | N/A | **FINDING, see #1** |
| governance | yes | yes | yes | yes | yes | wired |
| licensing | yes | yes | yes | yes | yes | wired |
| managed-provider | yes | yes | yes | **exists, dead — not listed, no consumer** | yes | FINDING, see #5 |
| saas | yes | **no Api, no app** | N/A (no process) | **exists, dead — not listed, no consumer** | N/A | **FINDING, see #4** |
| scim | yes | yes | yes | yes | **no — AuditLogApi unresolved** | FINDING (peer) |
| sso | yes | yes | yes | N/A (no browser) | **no — AuditLogApi unresolved** | FINDING (peer) |

## Modules fully wired, no findings of any kind

42 of 54: `analytics`, `annotation`, `api-key`, `auth`, `authz`,
`coding-agent`, `dashboard`, `data-privacy`, `data-retention`, `dataset`,
`entitlement`, `evaluation`, `experiment`, `feature-flag`, `gateway`,
`github`, `governance`, `identity`, `licensing`, `log`, `metric`,
`model-provider`, `monitor`, `navigation`, `notification`, `onboarding`,
`ops`, `organization`, `platform-health`, `presence`, `project`, `prompt`,
`role`, `scenario`, `secret`, `share`, `stored-object`, `topic`, `trace`,
`user`, `webhook`, `workflow`.

(`auth`, `github`, `notification`, `workflow` carry pre-existing,
already-baselined channel-registry debt noted above; they are counted here
because that debt is tracked, not a fresh "not linked up" finding.)

## Modules with a finding

12 of 54: `agent`, `automation`, `evaluator`, `scim`, `sso` (peer:
`AuditLogApi` unresolved — finding #2); `audit-log` (real implementation
uncatalogued — finding #2); `billing` (backend entirely unwired — finding
#1); `hosted-mcp` (transport declared, unmounted — finding #3); `saas`,
`managed-provider` (dead browser packages — findings #4, #5); `langy`,
`suite` (browser shared outside the kit law — finding #6).
