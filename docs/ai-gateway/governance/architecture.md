---
title: LangWatch governance — architecture
description: How the personal-keys flow, AI Gateway, Activity Monitor, RoutingPolicy admin, and IngestionSource pipeline fit into one control plane.
---

# LangWatch governance — architecture

## What problem this is solving

Enterprises run AI through many surfaces simultaneously: developer
CLIs (Claude Code, Codex, Cursor, Gemini CLI), packaged SaaS that
embed AI (Cowork, Copilot Studio, Workato Genies, ChatGPT Enterprise),
and bespoke agents written in-house. Each comes with its own auth
plane, its own admin console, its own audit trail. There's no single
view of "what is every AI in our org doing right now," no consistent
budget enforcement across them, no one-throat-to-choke for the
security team when an agent misbehaves at 3 AM.

LangWatch is the **control plane** that sits above all of this. It
provides governance, monitoring, evals, and (for the surfaces we
proxy) policy enforcement — across every AI tool and platform the
enterprise uses, regardless of who built each one.

## The five integration tiers

Different platforms allow different levels of governance. We model
this as a ladder, deepest control on top:

```
┌─ Tier A — Gateway proxy ─────────────────────────────────────────────┐
│ Customer's API key flows through LangWatch's AI Gateway.            │
│ Mid-flight inspection, rewrite, block. Examples: Claude Code,       │
│ Codex, Cursor (with custom endpoint), any custom agent, Workato     │
│ BYOK, Vertex AI, Bedrock-via-proxy.                                 │
└──────────────────────────────────────────────────────────────────────┘
┌─ Tier B — BYOK endpoint routing ─────────────────────────────────────┐
│ Closed SaaS that supports a custom-LLM endpoint setting. Customer   │
│ points the platform at LangWatch's gateway. Same depth as Tier A    │
│ for traffic that flows through. Examples: parts of Workato Genies,  │
│ open agent frameworks that accept ANTHROPIC_BASE_URL.               │
└──────────────────────────────────────────────────────────────────────┘
┌─ Tier C — Audit log ingestion ───────────────────────────────────────┐
│ Closed SaaS we cannot proxy. Pull audit / OTel / S3-delivered logs  │
│ from the platform's admin API. Observational governance: detect,    │
│ alert, recommend, trigger admin-API revokes — but no mid-flight     │
│ block. Examples: Cowork (OTel push), Copilot Studio (Office 365     │
│ Management Activity API pull), ChatGPT Enterprise (Compliance       │
│ Platform pull), Claude Enterprise (Compliance API pull), Workato    │
│ (audit log streaming push), Gemini for Workspace (Cloud Logging).   │
└──────────────────────────────────────────────────────────────────────┘
┌─ Tier D — OTel / SDK instrumentation ────────────────────────────────┐
│ Customer's own agents emitting traces via OpenInference / Traceloop │
│ / our SDK. Per-turn detail. Better than audit logs but not          │
│ proxyable. Examples: Cowork's native OTel feed, customer agents     │
│ with our SDK installed.                                             │
└──────────────────────────────────────────────────────────────────────┘
┌─ Tier E — Sandboxed runtime ─────────────────────────────────────────┐
│ LangWatch hosts the agent runtime. Maximum control: egress policy,  │
│ MCP allowlist, per-tool approval gates. Premium / post-land         │
│ expansion. Examples: Open Managed Agents within LangWatch, Hermes   │
│ / OpenClaw run sandboxed.                                           │
└──────────────────────────────────────────────────────────────────────┘
```

A real organization typically uses several tiers concurrently:
Tier A for in-house custom agents and any BYOK SaaS, Tier C for
closed platforms whose runtime they don't own (Claude Cowork,
Workato, Copilot Studio, Claude for Work), Tier D for whichever of
those platforms expose OTel export, and Tier E later for high-trust
agents they want sandboxed inside their LangWatch deployment.

## The control plane, end to end

```
┌────────────────────────────────────────────────────────────────────┐
│                  LANGWATCH CONTROL PLANE                           │
│                                                                    │
│   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐       │
│   │  Identity      │  │  Policy        │  │  Telemetry     │       │
│   │  (Okta SSO,    │  │  (RoutingPol-  │  │  (per-trace    │       │
│   │   personal     │  │   icy, budget, │  │   spend, OCSF  │       │
│   │   workspaces)  │  │   PII rules)   │  │   normalised)  │       │
│   └───────┬────────┘  └───────┬────────┘  └───────┬────────┘       │
│           │                   │                   │                │
│           └────────┬──────────┴──────────┬────────┘                │
│                    │                     │                         │
│   ┌────────────────▼─────────────┐   ┌───▼────────────────────┐    │
│   │   AI Gateway (Tier A/B)      │   │  Activity Monitor       │    │
│   │   - virtual keys             │   │  (Tier C/D)             │    │
│   │   - mid-flight policy        │   │  - IngestionSource      │    │
│   │   - per-call cost / OTel     │   │  - OCSF normalisation   │    │
│   └────────────────┬─────────────┘   │  - anomaly detection    │    │
│                    │                  │  - admin-API revoke     │    │
│                    │                  └────────┬─────────────────┘    │
│                    └──────────────────┬────────┘                  │
│                                       │                            │
│                            ┌──────────▼──────────┐                 │
│                            │  Unified dashboard  │                 │
│                            │  /me  /admin  /set  │                 │
│                            └─────────────────────┘                 │
└────────────────────────────────────────────────────────────────────┘
                                ▲
                                │
   ┌────────────────────────────┴────────────────────────────────┐
   │                         END-USER SURFACES                    │
   │                                                              │
   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
   │  │ Browser  │ │  CLI     │ │  Closed  │ │   Sandboxed      │ │
   │  │  /me     │ │ langwatch│ │   SaaS   │ │   runtime (E)    │ │
   │  │ /admin   │ │ login... │ │ (C/D)    │ │   (OMA / Hermes  │ │
   │  │ /settings│ │ claude.. │ │          │ │   / OpenClaw)    │ │
   │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ │
   └──────────────────────────────────────────────────────────────┘
```

## Data flow per tier

### Tier A — Gateway proxy

```
dev's CLI / agent  ──┐
   ANTHROPIC_AUTH_TOKEN=vk-lw-*       ┌─────────────────────────┐
   ANTHROPIC_BASE_URL=gw.lw.ai/api   ▶│  AI Gateway (Bifrost)   │
                                      │  • resolve VK → policy  │
                                      │  • check budget         │
                                      │  • PII inspection       │
                                      │  • route to provider    │
                                      └────────────┬────────────┘
                                                   │
                          ┌───────────── per-trace OTel
                          │
                          ▼
                ┌────────────────────────────────────┐
                │  Trace pipeline                     │
                │  - canonicalise attributes          │
                │  - cost calc per token usage        │
                │  - emit to ClickHouse               │
                │  - emit to GatewayBudget reactor    │
                └────────────────────────────────────┘
```

### Tier C — Audit log ingestion

```
Closed SaaS (Cowork / Copilot / Workato / OpenAI / Claude / S3)
         │
         ├─ PUSH (OTel / webhook / S3 drop)
         │      ▶  /api/ingest/<source-type>/<source-id>
         │             ─ validates IngestionSource ingestSecret
         │             ─ parses platform-specific shape
         │             ─ normalises into OCSF ActivityEvent class
         │
         ├─ PULL (Office365 / OpenAI Compliance / Claude Compliance)
         │      ▶  Scheduled job per IngestionSource
         │             ─ polls upstream API on configured cadence
         │             ─ normalises into OCSF
         │             ─ persists watermark for next poll
         │
         └─ Result: events land in trace_summaries with
                    SourceType = <platform>, SourceId = ingestion source id
```

## Data model

### Postgres (Prisma)

| Table | Purpose | Notes |
|---|---|---|
| `Organization` | Billing entity / tenant boundary | Top of hierarchy |
| `Team` (`isPersonal`) | Grouping unit | `isPersonal=true` for auto-created personal teams |
| `Project` (`isPersonal`) | Work artifact: agents, datasets, evals | `isPersonal=true` for personal projects |
| `User`, `OrganizationUser`, `RoleBinding` | Identity + RBAC | RoleBindings replacing legacy TeamUser |
| `RoutingPolicy` | Provider chain template | Org-scoped; hierarchical via `scope`+`scopeId` |
| `VirtualKey` | The actual credential issued to a caller | `organizationId` + `VirtualKeyScope[]` (multi-scope at ORG/TEAM/PROJECT); references RoutingPolicy; optional `principalUserId` for personal VKs |
| `VirtualKeyScope` | One scope row per VK (1:N) | Cascade upward to derive eligible ModelProviders |
| `ModelProvider` | Upstream LLM API key (basic creds) + Gateway-only fields (RPM/TPM/RPD, fallback priority, providerConfig) on the **Advanced (Gateway)** tab | Scoped to ORGANIZATION/TEAM/PROJECT; one record per credential — no separate gateway binding |
| `GatewayBudget` | Spend limit | Scope = ORG / TEAM / PROJECT / VK / PRINCIPAL |
| `IngestionSource` | Per-platform fleet config | Org-scoped; carries ingestSecret + parserConfig |

### ClickHouse

| Table | Purpose | New columns for governance |
|---|---|---|
| `trace_summaries` | One row per trace | `SourceType` (LowCardinality), `SourceId` (String), `OrganizationId` (bloom-indexed) |
| `stored_spans` | Span-level detail | inherited TenantId scoping unchanged |
| `event_log` | Event-sourced audit trail | inherited |
| `gateway_budget_ledger_events` | Per-trace spend per applicable budget | `principal_user_id` already first-class |

`TenantId = projectId` invariant is preserved across all tables —
`OrganizationId` is added as a **query dimension** for cross-project
rollup, not a tenancy boundary swap.

## OCSF + AOS event schema

We adopt
[Open Cybersecurity Schema Framework (OCSF)](https://ocsf.io/) as the
internal event shape, extended with
[OWASP Agent Observability Standard (AOS)](https://aos.owasp.org/)
fields for AI-specific context. Why:

- Datadog Cloud SIEM, Splunk, Microsoft Sentinel, Elastic Security,
  Google Chronicle, Sumo Logic all natively understand OCSF — alert
  routing inherits these integrations for free.
- AOS extends OCSF's API Activity class (6003) with prompt / tool /
  cost / agent-session fields specifically for AI activity.
- Adopting an open standard keeps us interoperable with whatever
  tooling the customer already has (we're never the system of record).

Each `IngestionSource` adapter normalises platform-specific shapes
into OCSF + AOS fields before they hit `trace_summaries`. The
adapters are the only platform-specific code; everything downstream
(dashboard, alerts, anomaly detection, admin-API revokes) speaks
OCSF.

## Stop/observe matrix per platform

| Platform | Tier | Real-time stop | Triggered admin action | Alert-only |
|---|---|---|---|---|
| Claude Code / Codex CLI / Cursor / custom agent | A | ✅ via Gateway | n/a | n/a |
| Workato (BYOK route) | A/B | ✅ | n/a | n/a |
| Workato (audit log push) | C | ❌ | ✅ pause recipe via Platform API | — |
| Cowork desktop | C/D | ❌ | ✅ revoke workspace key via Anthropic Admin | — |
| Copilot Studio | C | ❌ | ✅ disable agent via Power Platform admin | — |
| ChatGPT Enterprise / Codex (cloud) | C | ❌ | ✅ revoke key via OpenAI Compliance | — |
| Claude Enterprise / Cowork (cloud) | C/D | ❌ | ✅ revoke workspace key | — |
| Gemini for Workspace | C | ❌ | ✅ via Google Workspace admin | — |
| Salesforce Einstein / Slack AI / Notion AI | — | ❌ | ❌ | ✅ alert only |

This is what gets reflected in the Activity Monitor's "actions
available" UI per anomaly, and what determines which adapter shipping
order we prioritise.

## Feature-flag gating

Every governance UI surface is gated behind one app feature flag —
`release_ui_ai_governance_enabled` — so this long-lived branch can
merge into main without exposing in-progress features to current
customers. The CLI surface is always available once installed; per-
account governance entitlement is enforced server-side.

The AI Gateway product itself ships as-is to customers on the
existing `release_ui_ai_gateway_menu_enabled` flag. The governance
flag is intentionally separate — they're different product lines
with different rollout cadences.

Backend endpoints stay reachable regardless of flag state. Per
@rchaves's directive, hiding the user-visible surface is enough; the
data model + tRPC routes + REST endpoints + ingestion receivers all
exist on every deployment, just not linked to from any visible UI
when the flag is off.

See `specs/ai-gateway/governance/feature-flag-gating.feature` for the
gating contract.

## Roadmap to full vision

What's on this branch today:
- ✅ Personal Workspace (Team+Project, `isPersonal` flag)
- ✅ RoutingPolicy admin UI + provider-cred org validation
- ✅ Personal VirtualKeys + admin catalog
- ✅ Unified `langwatch` CLI (10 governance subcommands, device-flow auth)
- ✅ `/me` + `/me/settings` + `/settings/routing-policies`
- ✅ AI Gateway with personal-key support
- ✅ `user.personalBudget` tRPC + `BudgetExceededBanner`
- ✅ Helm NOTES + post-install docs
- ✅ Single feature flag (`release_ui_ai_governance_enabled`) gating the UI surface; CLI surface is unconditionally installed and per-account entitlement is enforced server-side (no CLI-side env var gate)
- ✅ This architecture doc + activity-monitor + ingestion-sources specs

What this iteration adds (D2 foundation):
- 🚧 `IngestionSource` table + `trace_summaries.SourceType`/`SourceId` columns
- 🚧 Generic OTel passthrough receiver (`/api/ingest/otel/<sourceId>`)
- 🚧 Generic webhook receiver (`/api/ingest/webhook/<sourceId>`)
- 🚧 OCSF normalisation contract + skeleton adapter

Deferred to follow-up iterations:
- Cowork OTel adapter (depends on Anthropic Admin Console UX)
- Workato webhook adapter
- Copilot Studio / OpenAI / Claude Compliance pullers
- S3 audit with custom parser DSL
- Anomaly detection (rule-based v0)
- Alert routing destinations (Slack / SIEM / PagerDuty / generic webhook)
- Admin oversight dashboard (cross-source spend rollup UI)
- Provider/tool catalog admin
- Tier E sandboxed runtime (OMA in LangWatch)
- Activity Monitor admin-API revoke actions per platform

Each deferred adapter ships as its own slice with its own spec under
`specs/ai-gateway/governance/`. The foundation in this iter unblocks
all of them.

## Where each piece lives in the repo

```
langwatch/src/server/governance/                     # Personal workspace, VK, RoutingPolicy services
langwatch/src/server/gateway/                        # AI Gateway (Bifrost-embedded), virtual keys, budgets
langwatch/src/server/routes/auth-cli.ts              # Device-flow + access tokens + budget/status
langwatch/src/server/routes/ingest/                  # IngestionSource receivers (this iter)
langwatch/src/server/governance/activity-monitor/    # OCSF normalisation + adapters (this iter)
langwatch/src/server/api/routers/personalVirtualKeys.ts
langwatch/src/server/api/routers/routingPolicies.ts
langwatch/src/server/api/routers/user.ts             # personalContext + personalUsage + personalBudget
langwatch/src/components/me/                         # /me layout + dashboard
langwatch/src/components/WorkspaceSwitcher.tsx       # Single context switcher
langwatch/src/components/BudgetExceededBanner.tsx    # Cross-surface 402 renderer
langwatch/src/pages/me/                              # /me + /me/settings
langwatch/src/pages/settings/                        # Admin routing policies, ingestion sources, activity monitor
langwatch/src/pages/cli/auth.tsx                     # Device-flow approval UX

typescript-sdk/src/cli/commands/                     # Unified langwatch CLI
typescript-sdk/src/cli/utils/governance/             # Device-flow client, config, wrappers

charts/langwatch/                                    # Umbrella chart with NOTES.txt
charts/gateway/                                      # AI Gateway sub-chart

specs/ai-gateway/governance/                         # All BDD specs
docs/ai-gateway/governance/                          # User-facing docs
docs/ai-gateway/self-hosting/                        # Operator docs
```

## Where to read more

- [`gateway.md`](https://github.com/langwatch/langwatch) — full
  product strategy doc that drives this architecture.
- [`feature-flag-gating.feature`](https://github.com/langwatch/langwatch/blob/main/specs/ai-gateway/governance/feature-flag-gating.feature)
  — the single-flag / single-env-var contract.
- [`activity-monitor.feature`](https://github.com/langwatch/langwatch/blob/main/specs/ai-gateway/governance/activity-monitor.feature)
  — admin-side oversight UI contract.
- [`ingestion-sources.feature`](https://github.com/langwatch/langwatch/blob/main/specs/ai-gateway/governance/ingestion-sources.feature)
  — admin-side IngestionSource setup forms + lifecycle.
- [`personal-keys-deployment.feature`](https://github.com/langwatch/langwatch/blob/main/specs/ai-gateway/self-hosting/personal-keys-deployment.feature)
  — self-host deployment contract for the personal-keys flow.
- [`admin-setup.mdx`](./admin-setup.mdx) — admin's day-1 walkthrough.
- [`personal-keys.mdx`](./personal-keys.mdx) — end-user dev story.
- [`routing-policies.mdx`](./routing-policies.mdx) — RoutingPolicy concepts.
