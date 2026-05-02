# feat(governance): the LangWatch AI Governance Platform

> **Single canonical PR description for #3524** — kept up to date as the unified-trace
> branch correction lands, lane-by-lane. Edited live by Sergey (backend), Andre
> (docs/customer narrative), Alexis (UI walkthroughs + screenshots). Sync to GitHub via
> `gh pr edit -F .claude/PR-3524-DESCRIPTION.md`.

---

## Current status (iter29 — 2026-05-01)

> **Backend GA gate: FULLY GREEN.** All 6 lane-S slices closed (3a/3b/3c/3d/3e/3f) with backend GA verified at unit + integration depth (16 anomaly tests + 56/56 RBAC tests + per-slice integration suites).
>
> **Customer-facing docs flip: COMPLETE** end-to-end against ADR-018 unified-substrate framing. 4 waves shipped:
> - Wave 1 (`1e34cd9ef`): `trace-vs-activity-ingestion.mdx` reframed
> - Wave 2 (`f13c33e20`): NEW `compliance-architecture.mdx` + `retention.mdx` + `ocsf-export.mdx`
> - Wave 3 (`5bca796f2`): 8 ingestion-source pages reframed end-to-end
> - Wave 4 (`0b4f4d90e`): `personal-keys.mdx` storyboard refresh
>
> **Persona-aware experience: SHIPPED.** Initial 1.5b-viii claim ("persona-aware home") was scoped too narrowly to the URL redirect; iter29 dogfood review surfaced the chrome was unchanged from LLMOps defaults (`/me` rendered with two stacked selectors + irrelevant LLMOps sidebar). Cross-lane fix landed end-to-end:
> - `a935d707e` chrome refactor — new `PersonalSidebar`; `DashboardLayout` swaps to WorkspaceSwitcher + PersonalSidebar on personal scope; `MyLayout` shrinks; `MainMenu` drops chicken-and-egg `hasIngestionSources` predicate
> - `b311d1ca5` BDD spec FF correction (two-flag shape locked per @rchaves directive)
> - `385c95e89` AI Governance permissions catalog (5 new Resources × actions added to `rbac.ts`; ADMIN gets full set; MEMBER + EXTERNAL get none; custom-role JSON column = the production-shape delegation surface)
> - `043726430` chrome gate consumes `governance:view` permission instead of broad `organization:manage`
>
> **Persona-3 regression-safety invariant locked**: LLMOps majority (~90% of users today, no AI gateway) sees ZERO chrome change. DashboardLayout untouched for project_only persona. Verified via BDD spec.
>
> **Rollout sequence (per @rchaves directive)**: two-phase FF rollout. Phase 1 → flip `release_ui_ai_gateway_menu_enabled` ON → Gateway menu + personal-key flow visible. Phase 2 (later) → flip `release_ui_ai_governance_enabled` ON → Governance dashboard + ingestion-sources + anomaly-rules + OCSF export visible. Two flags, not one — preserves pilot flexibility (gateway-only vs governance-only customer rollouts).
>
> **Open vote resolution (per @rchaves 2026-05-02)**:
> - **Vote D** — Personal-key SSO provisioning: **(a) Apache 2.0 / works for everyone**. Can restrict later via plan-cap follow-up (tracked separately as #3686).
> - **Vote F** — BSL→Apache 2.0 license-flip timing: **(b) follow-up PR**. But this PR's design + docs + UX pretend Apache 2.0 floor is already in place (free-tier framing, demo-loop wedge copy, etc.).
> - **Vote G** — Phase 1B.5 sequencing: **(a) parallel** — keep going as already running.
> - **Vote H** — License relocation Phase 4 in this PR vs follow-up: **SPLIT** (3-lane consensus + locked earlier). This PR ships behavior; follow-up PR ships file relocation.
> - **Vote I** — Persona-home rollout shape: **(a) feature-flag-gated** — `release_ui_ai_governance_enabled` defaults OFF on merge. Safer rollout; pilot per org via PostHog.
>
> **iter32 live-fire — END-TO-END CONFIRMED.** The dogfood loop now runs from scratch in one command and produces real spend in the trace store. Sergey's `1544b834f` closed the last gateway-side blocker (`GatewayConfigMaterialiser.loadProviderChain` now resolves the policy-side `providerCredentialIds` for personal VKs minted via RoutingPolicy, not just direct VK→credential bindings). Alexis verified end-to-end: fresh seeded P4 admin → `seed-personas --mint-vk` → 3 `gpt-4o-mini` completions through the local Go gateway → spans land in `langwatch.stored_spans` with `langwatch.virtual_key_id` + `gen_ai.usage.{input,output}_tokens` populated; `/governance` chrome loads with GOVERN sidebar visible; `/me/usage` chrome correct.
>
> **One open product question, captured as follow-up (not in this PR per @master_orchestrator)**: `/me/usage` shows zero spend until an admin attaches a Budget — the spend column is driven by `gateway_budget_ledger_events` fold, which only writes when a Budget applies. Lane-S recommendation (Sergey, iter32): separate the usage-display query from the Budget-limit machinery so `/me/usage` aggregates spans directly scoped by `principal_user_id` regardless of Budget binding ("Budget is the LIMIT machinery; usage display is independent"). Captured as a post-merge follow-up; not pulled into this PR. Documented in `admin-setup.mdx` Budget caveat note for the dogfood walkthrough.
>
> **Dogfood findings tracker (iter32 chrome-polish sweep)**: four UX bugs surfaced via the live-fire dogfood loop, all fixed in this PR:
> - **A** — Docs `/governance/{ingestion-sources,anomaly-rules}` route drift (404 for fresh admins clicking through nav). Fixed in `0f9ccad2c` (lane-A): 8 doc files corrected to `/settings/governance/...`.
> - **B** — GOVERN sidebar entry missing for fresh ORG ADMIN despite the new RBAC catalog. Fixed in `a85ba27ff` (lane-S): `useOrganizationTeamProject.hasPermission` org-prefix check now recognises all 5 governance resource families (was string-prefix-only on `organization:`).
> - **C** — "Sharing presence" link in `PersonalSidebar` (post-merge add) reviewed; resolved by inspection — `PresenceToggle` is `MainMenu`-only by design (no teammates to share with in personal scope), architecturally correct.
> - **D** — `/settings/routing-policies` 500 for fresh ORG ADMIN (read path drift). Fixed in `ff79b951d` (lane-B): `routingPolicy.list/get` now uses `checkOrganizationPermission('organization:view')` to match `costs/limits/ingestionSources` convention; the hand-rolled `assertOrgMembership` was unreachable due to `skipPermissionCheck`'s sensitive-input meta-rule rejecting `organizationId` before the fallback ran. Code-quality follow-up filed as [#3687](https://github.com/langwatch/langwatch/issues/3687) — `skipPermissionCheck` should throw a typed `PermissionMisconfiguredError` naming the offending key + suggesting `checkOrganizationPermission`, so the next project→org route migration that forgets to swap the helper fails loudly instead of with an opaque 500.
> - **E** — Local dogfood `NotFoundScene` for `/governance` + `/settings/governance/*` despite the gateway flag being on. Fixed in `e303ec709` (lane-B, docs-only): `.env.example` `FEATURE_FLAG_FORCE_ENABLE` now lists both `release_ui_ai_gateway_menu_enabled` AND `release_ui_ai_governance_enabled` by default, with a 4-line explainer of the symptom. The two-flag runtime semantic is unchanged (still preserves pilot flexibility per @rchaves directive); only the local-dev default flipped to enable both. `admin-setup.mdx` dogfood loop step 1 also names both flags explicitly.
> - **F** — RBAC defense-in-depth gap: sidebar gate (`a85ba27ff`) correctly hid Govern/Gateway for MEMBER but every governance read tRPC was still gating on `organization:view` (which MEMBER has) instead of the new resource-specific catalog (`385c95e89`). MEMBER calling those tRPCs directly leaked governance state. Fixed in `9e373c284` (lane-S): 4 routers re-wired to resource-specific permissions + new `governance.rbac.integration.test.ts` (11/11 green) proving MEMBER → UNAUTHORIZED on every governance read endpoint, ADMIN → 200, `resolveHome` regression-invariant preserved. Full mapping + evidence chain in §"RBAC defense-in-depth — router-layer enforcement" below.
> - **G** — Persona-1 (org-less CLI/IDE dev) bounced to `/onboarding/welcome` on every navigation including direct-load of `/me`; spec says they should land at `/me`. Fixed in `c991006c3` (lane-B): three surgical edits closing a 3-layer race — (1) `/index` no-org bouncer fired before the persona resolver, (2) `/me` + `/me/settings` were absent from `noOrgBouncerRoutes` so `CommandBar`'s global `useOrganizationTeamProject({redirectToOnboarding:true})` won the race, (3) `/me` + `/me/settings` FF gate `enabled:!!project` never fired for persona-1. Single commit, typecheck green. Browser verification in flight from @ai_gateway_alexis_2.

---

## Reviewer's quick read — where to start

This PR is large (215+ commits, multi-week, 3-lane). If you have **30 minutes**, walk this trail in order — every step has a single concrete entry point:

1. **The pitch (3 min)** — read the next section below ("What this PR ships"). It's the customer-facing one-paragraph framing; everything else justifies it.
2. **The contract (5 min)** — open `specs/ai-gateway/governance/architecture-invariants.feature`. The unified-substrate decision is *this file*. Everything else is a consequence. Skim sibling `.feature` files to see the BDD trail (26 files in `specs/ai-gateway/governance/`).
3. **The receiver code (5 min)** — `langwatch/src/server/routes/ingest/ingestionRoutes.ts` — both `POST /api/ingest/otel/:sourceId` (span-shaped) and `POST /api/ingest/webhook/:sourceId` (flat) live here as thin wrappers around the shared hardened parser at `langwatch/src/server/otel/parseOtlpBody.ts`. The decision tree in §"Architecture — at a glance" below maps directly to these two paths.
4. **The hidden Governance Project (5 min)** — `langwatch/src/server/governance/governanceProject.service.ts`. The internal-only Project that makes the unified store viable. §"The hidden Governance Project — invariants" below names the Layer-1 + Layer-2 tests that enforce it never leaks to user-facing surfaces.
5. **The fold projections (5 min)** — `langwatch/src/server/event-sourcing/pipelines/trace-processing/reactors/governanceKpisSync.reactor.ts` + `governanceOcsfEventsSync.reactor.ts`. Derived data, rebuildable from `event_log`. KPI reactor feeds anomaly + activity-monitor; OCSF reactor feeds SIEM export.
6. **The persona-aware experience (5 min)** — `specs/ai-gateway/governance/persona-aware-chrome.feature` (BDD contract) + `langwatch/src/components/DashboardLayout.tsx` (the layout swap). Persona-3 (LLMOps majority, ~90% of users) regression-safety invariant is FIRST in the spec file by design.
7. **The dogfood loop (2 min)** — `docs/ai-gateway/governance/admin-setup.mdx#try-it-locally-dogfood-loop` walks the full sign-up → seed-personas → fire-completion → /me/usage flow against your local stack. Reproducible by you, not just the team.

If you have **5 minutes**, skip to step 7 (dogfood loop) and skim the screenshots in §"UI flows + screenshots" below.

**What to push back on, if anything:** the `ee/` license-relocation Phase 4 is *deferred to a follow-up PR* per @rchaves vote H — the behavior ships here, the file moves ship next. If you want it done in-PR, flag it and we'll reopen the vote.

---

## The pitch — what this PR ships

> "Your engineers are running AI through Workato Genies, Claude for Work, Copilot
> Studio agents, Cursor, Claude Code, and a dozen homegrown agents. You have no
> idea who's doing what, what it's costing, or which agent just did 1,000 actions
> at 3 AM on a Saturday. **LangWatch sits above all of it.** We ingest audit data
> from every AI platform you use, proxy the traffic your teams' keys control, run
> anomaly detection and policy enforcement across everything, and give you a
> sandboxed runtime for the agents you really don't trust. **One dashboard, one
> policy engine, one throat for your security team to choke."**

This PR is the **substrate that makes that pitch real**. It introduces:

- **A single unified observability store** for every AI event the customer's
  enterprise generates — application traces (their own apps), proxied gateway
  traffic (their VK-controlled apps), and ingested audit data from third-party
  AI platforms (Cowork, Workato, S3 audit drops, Copilot Studio, OpenAI/Claude
  compliance feeds). All in `recorded_spans` + `log_records` + `trace_summaries`.
  No parallel governance backend.
- **Per-origin retention** so SOC 2 / ISO 27001 / EU AI Act / GDPR / HIPAA-most-uses
  retention obligations don't force operational traces to balloon to 7 years.
- **A hidden internal Governance Project** as the routing/RBAC/retention context
  that makes the unified store viable — never appears in any user-visible Project
  surface, enforced by Layer-1 + Layer-2 invariant tests against live data.
- **Governance fold projections** (`governance_kpis` for KPIs/anomaly,
  `governance_ocsf_events` for SIEM forwarding) on top of the same unified
  store — derived data, rebuildable from `event_log`, single source of truth.
- **Anomaly detection** (spend_spike today, more rule types behind the same
  reactor pattern) that consumes the fold, not raw partition scans.
- **OCSF export** so security teams can pull audit events into Splunk / Datadog
  Security / AWS Security Hub / Sentinel / Elastic Security / Sumo Logic CSE.

**What this PR does NOT ship** (filed-not-abandoned for the next hardening layer):
cryptographic Merkle-root tamper-evidence (the SEC 17a-4 / HITECH-strict bar);
heavyweight SIEM PUSH infrastructure (DLQ + per-org webhook UI + replay).

**Compliance bar shipped**: SOC 2 Type II / ISO 27001 / EU AI Act baseline /
GDPR / HIPAA-most-uses. Compliance bar deferred: SEC 17a-4 / HITECH strict /
EU AI Act high-risk-systems tier (cryptographic tamper-evidence required).

---

## Architecture — at a glance

### The receiver-shape decision tree

```
                              POST /api/ingest/<mode>/<sourceId>
                              │
                              ▼
                  authIngestionSource (Bearer lw_is_*)
                              │
                              ▼
                ┌─────────────────────────────────┐
                │ Source.sourceType drives shape  │
                └─────────────────────────────────┘
                              │
              ┌───────────────┴────────────────┐
              ▼                                ▼
        SPAN-SHAPED                    FLAT-EVENT
        (otel_generic                  (workato webhook
         claude_cowork)                 s3_custom audit
                                        copilot_studio
                                        openai_compliance
                                        claude_compliance)
              │                                │
              ▼                                ▼
   readOtlpBody (gzip/                buildWebhookLogRequest
   deflate/brotli) +                  (envelope → ILogRecord
   parseOtlpTraces                     with origin attrs)
              │                                │
              ▼                                ▼
   stampOriginAttrs(...)              [origin attrs already
              │                        stamped by builder]
              │                                │
              ▼                                ▼
    ensureHiddenGovernanceProject(orgId)   ← single central helper
              │                                │
              ▼                                ▼
   handleOtlpTraceRequest             handleOtlpLogRequest
   (existing /v1/traces handler)      (existing /v1/logs handler)
              │                                │
              ▼                                ▼
        recorded_spans                   log_records
              │                                │
              └────────────────┬───────────────┘
                              ▼
                       trace-processing
                       event-sourcing pipeline
                       (PR #3351 reactor pattern)
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
     governance_kpis fold           governance_ocsf_events fold
     (org × source × hour →         (Actor / Action / Target /
      spend / events / tokens)       Time / Severity for SIEM)
              │                               │
              ▼                               ▼
   /governance dashboard           SIEM export pull API
   anomaly reactor (spend_spike)   (Splunk / Datadog Sec / etc.)
```

### Reserved attribute namespaces (origin metadata contract)

| Attribute | Source | Set by |
|---|---|---|
| `langwatch.origin.kind = "ingestion_source"` | source identity | receiver |
| `langwatch.ingestion_source.id` | source identity | receiver |
| `langwatch.ingestion_source.organization_id` | source identity | receiver |
| `langwatch.ingestion_source.source_type` | source identity | receiver |
| `langwatch.governance.retention_class` | derived/system-owned | receiver from `IngestionSource.retentionClass` |
| `langwatch.governance.anomaly_alert_id` | derived/system-owned | anomaly reactor on flagged spans |

Per master architecture lock: `langwatch.origin.*` is source-of-truth identity;
`langwatch.governance.*` is system-derived. The trace viewer renders both as
read-only system metadata; users cannot supply or edit them.

### Data schemas — what lands in this PR

| Layer | Change | Migration |
|---|---|---|
| Postgres | `Project.kind` (string, default `"application"`, with composite index `(teamId, kind)`) | `20260427030000_add_governance_metadata` |
| Postgres | `IngestionSource.retentionClass` (string, default `"thirty_days"`) | `20260427030000_add_governance_metadata` |
| Postgres | `IngestionSource` model (the per-platform fleet config with HMAC bearer secret + parserConfig) | earlier in branch |
| Postgres | `AnomalyRule` + `AnomalyAlert` | earlier in branch |
| ClickHouse | `gateway_activity_events` table **DROPPED** — was the wrong direction | `00020_drop_gateway_activity_events.sql` |
| ClickHouse | `governance_kpis` fold projection | step 3/3 (in flight) |
| ClickHouse | `governance_ocsf_events` fold projection | step 3/3 (in flight) |

### Source-of-truth vs derived data

- **Source of truth**: `event_log` (append-only, the durability foundation)
  → `recorded_spans` + `log_records` (the unified observability substrate)
- **Derived projections** (rebuildable from `event_log`):
  - `trace_summaries` (existing; per-trace rollup)
  - `governance_kpis` (new in this PR; per-(org, source, hour) rollup)
  - `governance_ocsf_events` (new in this PR; OCSF-shape view)
- **Read APIs**:
  - `/governance` dashboard ← `governance_kpis` + `recordedSpans`/`log_records`
    with origin filter
  - SIEM export ← `governance_ocsf_events` cursor-paginated
  - anomaly reactor ← `governance_kpis` (cheap pre-aggregated)

---

## Receiver flow — code pointers

### Span-shaped path (`/api/ingest/otel/:sourceId`)

`langwatch/src/server/routes/ingest/ingestionRoutes.ts`:

1. `authIngestionSource(c)` — `Authorization: Bearer lw_is_*` → `IngestionSource`
   (24h grace on rotated secrets).
2. `readOtlpBody(c.req.raw)` — shared parser at `langwatch/src/server/otel/parseOtlpBody.ts`,
   handles gzip/deflate/brotli per `Content-Encoding`.
3. `parseOtlpTraces(body, contentType)` — same shared helper; handles protobuf,
   JSON, and the JSON-then-protobuf-encode fallback path (mirrors the hardened
   `/api/otel/v1/traces` receiver byte-for-byte).
4. `ensureHiddenGovernanceProject(prisma, source.organizationId)` —
   `langwatch/src/server/governance/governanceProject.service.ts`. Single
   central lazy-ensure helper. Idempotent under concurrent first-mint races.
   Throws if the org has no team.
5. `stampOriginAttrs(parsed.request, source)` — appends the five origin
   attributes (above) onto every span in the parsed request, in-place.
6. `getApp().traces.collection.handleOtlpTraceRequest(govProject.id, request, piiRedactionLevel)`
   — the EXISTING trace pipeline. Same handler `/api/otel/v1/traces` calls. The
   receiver does NOT write CH directly.

Response: `202 {accepted, bytes, events, rejectedSpans?, hint?}`. The `hint`
field surfaces only when `bytes > 0 && events == 0` — onboarding-friendly
diagnostic for fresh-admin first-event setup.

### Flat-event path (`/api/ingest/webhook/:sourceId`)

Same file. Mirrors the OTel path with two differences:

1. Body is read as text (no OTLP parse) — the body IS the event payload.
2. `buildWebhookLogRequest(rawBody, source)` constructs a single OTLP
   `IExportLogsServiceRequest` with one `log_record`:
   - `body.stringValue = rawBody`
   - `severityNumber = 9` (INFO)
   - `attributes` carry the same five origin metadata attributes
   - timestamp = now (per-platform adapters override with the source's event
     time when they ship)
3. Handoff via `getApp().traces.logCollection.handleOtlpLogRequest({tenantId: govProject.id, ...})`
   — the EXISTING log pipeline. Same handler `/api/otel/v1/logs` calls.

Per-platform deeper mappers (workato job arrays, S3 DSL parsing, Copilot Studio
Purview event shapes) ship as follow-up adapters that REPLACE
`buildWebhookLogRequest` with their richer per-event shape but keep the same
handoff target.

---

## The hidden Governance Project — invariants

Per master architecture lock: the hidden Governance Project is an **internal
routing / tenancy artifact only**. It must NEVER appear in any user-visible
Project surface (project picker, project list, `/api/v1/projects`, billing
exports, RBAC role-binding pickers). Layer-1 + Layer-2 invariant tests (below)
codify this.

- **Lifecycle**: lazy-ensured on first IngestionSource mint via
  `ensureHiddenGovernanceProject(orgId)`. Feature-flag activation alone does
  NOT create a Governance Project; only a real governance entity mint triggers
  it. Idempotent under concurrent races.
- **Schema**: `Project.kind = "internal_governance"` (vs default
  `"application"`). Composite index `(teamId, kind)` makes the filter cheap.
- **Layer-1 filter** (single Prisma extension): `PrismaOrganizationRepository.getAllForUser`
  filters `kind: { not: "internal_governance" }`. Bulk of UI consumers funnel
  through `useOrganizationTeamProject` → `getAllForUser` → filtered.
- **Layer-2 filter** (per-consumer assertions): UI-facing Project consumers
  individually assert non-leakage. Codified in `ui-contract.feature`. Live-data
  invariant tests against testcontainers + dogfood org.
- **RBAC**: project-membership is the access-control mechanism. Org admins +
  auditor-role get read access; project members do NOT see governance-origin
  spans in their `/messages`. This is FREE — same RBAC the existing trace
  pipeline already enforces — because governance data lives in a Project.
- **Public-share disabled**: `Project.traceSharingEnabled = false` on the
  Governance Project. Governance spans cannot be public-shared via existing
  trace-sharing UX.

---

## BDD specs — the executable contract (9 files / ~1,580 LOC)

Spec-first, code-follows. The full architecture lock is captured as testable
scenarios before the code lands. All committed to `specs/ai-gateway/governance/`:

| Spec file | Lane | Coverage |
|---|---|---|
| `architecture-invariants.feature` | Lane B (Alexis) | Cross-cutting: unified substrate, OTLP-shape per source, hidden Gov Project, origin/governance namespaces, fold derivation, tamper-evidence deferred |
| `ui-contract.feature` | Lane B (Alexis) | UI: single events feed, shape-aware drill-down, hidden Gov Project filter discipline at every Project consumer, retention dropdown, no project picker on the composer |
| `compliance-baseline.feature` | Lane A (Andre) | SOC 2 Type II / ISO 27001 / EU AI Act / GDPR / HIPAA-most-uses coverage; tamper-evidence deferred contract |
| `siem-export.feature` | Lane A (Andre) | OCSF v1.1 read API contract; 6 SIEM platforms named as cron-pull targets; thin-layer push only if it stays derived |
| `receiver-shapes.feature` | Lane S (Sergey) | Per-source OTLP shape (spans for span-shaped, logs for flat feeds); shared hardened parser; receiver as thin wrapper |
| `folds.feature` | Lane S (Sergey) | governance_kpis + governance_ocsf_events fold derivation; anomaly reactor reads fold not raw spans; fold rebuild from event_log |
| `retention.feature` | Lane S (Sergey) | Per-IngestionSource retention class (30d / 1y / 7y); CH TTL enforcement; org plan ceiling |
| `event-log-durability.feature` | Lane S (Sergey) | Append-only event_log foundation for non-repudiation; folds rebuildable; tamper-evidence deferred |
| `persona-aware-chrome.feature` (197 LOC, NEW iter29) | Lane B (Alexis) | Persona-aware chrome contract — sidebar + header per 4 personas; persona-3 regression-invariant FIRST in file; gateway.md Screen 6 layout; chicken-and-egg fix codified; FF-off split scenarios for two-flag pilot flexibility; single-chip-in-header invariant prevents iter29 dogfood-bug recurrence |

Cross-references: each spec cites siblings rather than duplicating scenarios.
Andre's `compliance-baseline.feature` references my `retention.feature` +
`event-log-durability.feature` as canonical sources for the mechanics; Alexis's
`architecture-invariants.feature` references all four lane-S specs.

---

## Reviewer-proof acceptance criteria → evidence map

For a reviewer asking "where's the proof for X?" — the highest-leverage acceptance criteria across the architectural lock, each pinned to its spec scenario + code location + test file + doc page. Read this top-to-bottom to verify the claims; pick a row to dig into the proof.

| # | Criterion | Spec | Code | Test | Doc |
|---|---|---|---|---|---|
| 1 | All ingestion-source data lands in unified `recorded_spans` + `log_records` (no parallel governance store) | `architecture-invariants.feature` Scenario "All ingestion-source data lands in the unified observability substrate" + "gateway_activity_events table no longer exists" | `langwatch/src/server/routes/ingest/ingestionRoutes.ts` | `d20a1b403` 13/13 integration (end-to-end HTTP receiver proof) | `compliance-architecture.mdx` §"The substrate, in one diagram" |
| 2 | Hidden Governance Project auto-created on first mint, never appears in any user-visible Project list | `architecture-invariants.feature` "Auto-created per org on first IngestionSource mint" + "Internal routing only" | `langwatch/src/server/governance/governanceProject.service.ts` (`ensureHiddenGovernanceProject`) | `0a2b7e8d9` 8/8 integration (first-mint + idempotent + 5-concurrent + cross-org tenancy) + `94426716e` 2/2 (Layer-1 filter at `PrismaOrganizationRepository.getAllForUser`) | `compliance-architecture.mdx` §"5. Hidden Governance Project" |
| 3 | Receiver stamps `langwatch.origin.*` on every payload; user-supplied `langwatch.*` rejected | `architecture-invariants.feature` "Receiver stamps langwatch.origin.* attributes" + "User-supplied langwatch.* attributes are rejected" | `langwatch/src/server/routes/ingest/ingestionRoutes.ts` + `langwatch/src/server/otel/parseOtlpBody.ts` | Part of `d20a1b403` end-to-end (5 origin attrs verified on every span/log_record) | `compliance-architecture.mdx` §"The substrate, in one diagram" |
| 4 | Span-shape sources emit OTLP traces; flat-event sources emit OTLP logs | `receiver-shapes.feature` (full file) | `ingestionRoutes.ts` (POST /api/ingest/otel vs /webhook) | Part of `d20a1b403` (400 wrong_endpoint on shape mismatch) | §"Architecture — at a glance" decision tree below + `ingestion-sources/index.mdx` |
| 5 | All ingestion writes flow through append-only `event_log`; folds + projections rebuildable | `architecture-invariants.feature` "All ingestion writes go through the append-only event_log" + `event-log-durability.feature` | `langwatch/src/server/event-sourcing/stores/repositories/eventRepositoryClickHouse.ts` + `event-sourcing/replay/replayEventLoader.ts` (CH schema in `00002_create_event_log.sql`) | `f25d713ab` 6/6 integration (round-trip + ALTER DELETE leaves log intact + payload fidelity post-view-deletion + cross-tenant isolation) | `compliance-architecture.mdx` §"1. Append-only event log" |
| 6 | `governance_kpis` + `governance_ocsf_events` derive from unified store via reactors; anomaly reactor reads fold not raw spans | `architecture-invariants.feature` "Governance KPI dashboard reads from a fold projection" + "Anomaly reactor reads from the governance fold" + `folds.feature` | `langwatch/src/server/event-sourcing/pipelines/trace-processing/reactors/governanceKpisSync.reactor.ts` + `governanceOcsfEventsSync.reactor.ts` | `governanceKpisSync.reactor.unit.test.ts` + `activityMonitor.service.integration.test.ts` (9/9 post-iter32) | `compliance-architecture.mdx` §"The substrate, in one diagram" |
| 7 | Per-IngestionSource retention class (30d / 1y / 7y); CH TTL enforced; system-derived per source | `retention.feature` (full file) | `langwatch/src/server/clickhouse/migrations/00026_add_retention_class.sql` + IngestionSource composer | `retentionClass.integration.test.ts` (TTL + write-side population) | `compliance-architecture.mdx` §"2. Per-origin retention class" + `retention.mdx` |
| 8 | RBAC permission catalog: 5 governance resources × actions; ADMIN gets full set; MEMBER + EXTERNAL get only `organization:view`; **enforced at the tRPC procedure layer** (sidebar gate + router gate; defense-in-depth) | `compliance-baseline.feature` + `persona-aware-chrome.feature` | `langwatch/src/server/api/rbac.ts` (5 new Resources) + governance.* / ingestionSources.* / anomalyRules.* / activityMonitor.* routers (`9e373c284`) | 56/56 RBAC unit (`rbac.test.ts`) + 11/11 router-layer integration (`governance.rbac.integration.test.ts`) | `compliance-architecture.mdx` §"3. RBAC — permission-driven, not role-driven" + `overview.mdx` §"Rollout & permissions" |
| 9 | Persona-3 (LLMOps majority, ~90% of users today) sees ZERO chrome change | `persona-aware-chrome.feature` (regression-invariant FIRST in file) | `langwatch/src/components/DashboardLayout.tsx` (untouched for project_only persona) | `persona-aware-chrome.feature` BDD scenario | `personal-keys.mdx` storyboard |
| 10 | Two-flag rollout (`release_ui_ai_gateway_menu_enabled` + `release_ui_ai_governance_enabled`) preserves Gateway-only vs Governance-only pilot flexibility | `persona-aware-chrome.feature` FF-off split scenarios + `b311d1ca5` | `langwatch/src/components/MainMenu.tsx` (chrome gates) + `useFeatureFlag` consumers | `persona-aware-chrome.feature` BDD | `overview.mdx` §"Rollout & permissions" + `compliance-architecture.mdx` §"Chrome visibility gates" + `admin-setup.mdx` dogfood-loop step 1 |
| 11 | OCSF v1.1 read API for SIEM cron-pull (Splunk ES, Datadog Security, AWS Security Hub, Microsoft Sentinel, Elastic Security, Sumo Logic CSE) | `siem-export.feature` (full file) | `langwatch/src/server/governance/governanceOcsfExport.service.ts` + `governanceOcsfEvents.clickhouse.repository.ts` | `governanceOcsfExport.service.integration.test.ts` | `ocsf-export.mdx` |
| 12 | Compliance baseline ships: SOC 2 Type II / ISO 27001 / EU AI Act general-purpose / GDPR / HIPAA-most-uses; cryptographic tamper-evidence (Merkle-root publication) named-not-abandoned for strict tier (EU AI Act high-risk, HIPAA covered-entity strict, SEC 17a-4) | `compliance-baseline.feature` (full file) | (substrate-level — no single file; see rows 1, 2, 5, 7, 8, 11) | (rows 1, 2, 5, 7, 8, 11 collectively) | `compliance-architecture.mdx` §"Framework coverage" + §"Tamper-evidence is named, not abandoned" |
| 13 | Gateway data plane terminates virtual-key traffic, fans out via Bifrost, materialises provider chain from RoutingPolicy.providerCredentialIds for personal VKs (not just direct VK→credential) | (Go gateway side; not in BDD scope) | `services/aigateway/internal/dispatch/*` + `langwatch/src/server/gateway/config.materialiser.ts` | iter32 live-fire confirmed end-to-end (3× completions through gateway, spans land in stored_spans) — closer commit `1544b834f` | `admin-setup.mdx` §"Try it locally (dogfood loop)" |

**Coverage summary**: each row maps a load-bearing claim from the iter29 banner / pitch to a spec-or-feature-file evidence anchor + a code path + a test (where the criterion is unit-or-integration-testable) + a customer-facing doc page (where applicable). Rows 9 + 10 + 13 also have iter32 dogfood evidence in the dogfood-findings tracker above (chrome walk for 9; FF defaults for 10; live-fire for 13).

### RBAC defense-in-depth — router-layer enforcement (iter32, fix landed `9e373c284`)

> **Status: FIXED in `9e373c284`.** @ai_gateway_sergey_2's iter32 access-gate dogfood pass surfaced a real defense-in-depth gap: the **sidebar gate** (`a85ba27ff`) correctly hid Govern/Gateway for MEMBER, but the **tRPC read endpoints** still gated on `organization:view` — which MEMBER has — instead of the new `governance:view` / `ingestionSources:view` / etc. catalog added in `385c95e89`. **A MEMBER calling those tRPCs directly (curl, browser devtools) succeeded — the catalog declared the model but the routers were never rewired.**
>
> **Mutations were already correct** — they gated on `organization:manage` (admin-only). Only the read paths drifted.
>
> **Router rewire in `9e373c284`** (was → now):
>
> | Endpoint | Before | After |
> |---|---|---|
> | `governance.setupState` | `organization:view` | `governance:view` |
> | `governance.ocsfExport` | `organization:manage` | `complianceExport:view` |
> | `governance.resolveHome` | `organization:view` | **kept** `organization:view` (regression-invariant: MEMBER /home redirect must still work) |
> | `ingestionSources.list/get` | `organization:view` | `ingestionSources:view` |
> | `ingestionSources.{create,update,rotateSecret,archive}` | `organization:manage` | `ingestionSources:manage` |
> | `anomalyRules.list/get` | `organization:view` | `anomalyRules:view` |
> | `anomalyRules.{create,update,archive}` | `organization:manage` | `anomalyRules:manage` |
> | `activityMonitor.*` (all 6 procedures) | `organization:view` | `activityMonitor:view` |
>
> **Evidence chain**:
> - **Spec contract**: `compliance-baseline.feature` + `persona-aware-chrome.feature` (ADMIN-only governance access declared)
> - **Catalog source**: `langwatch/src/server/api/rbac.ts` (5 governance Resources × actions, ADMIN bag full, MEMBER + EXTERNAL get only `organization:view`) — `385c95e89`
> - **Router patch**: `9e373c284` — 4 routers re-wired (governance, ingestionSources, anomalyRules, activityMonitor); 5 files / +320/-25
> - **Regression test**: `langwatch/src/server/api/routers/__tests__/governance.rbac.integration.test.ts` (11/11 green) — MEMBER session → `UNAUTHORIZED` on every governance read endpoint; ADMIN session → 200 OK; `resolveHome` stays callable for MEMBER (regression invariant verified)
> - **Browser dogfood evidence (lane-B, @ai_gateway_alexis_2)**: before/after screenshots in flight — MEMBER signed in directly loading `/governance` + `/settings/governance/*` + `/settings/routing-policies` post-fix; sidebar hidden in both states (B-fix surface), tRPC blocks the underlying call
> - **iter32 tracker entry**: F (folded into the table below)
>
> **Why this matters for the reviewer**: the sidebar gate alone is UI shaping, not authorization. A reviewer auditing for SOC 2 / ISO 27001 RBAC controls needs both the surface gate (B fix `a85ba27ff`) AND the enforcement boundary (`9e373c284`) to claim defense-in-depth. The catalog declared the model in iter29 (`385c95e89`); the router rewire closes the loop. Row #8 of the criterion → evidence map above is updated.

---

## Verification — backend tests passing today

| Commit | Tests | Coverage |
|---|---|---|
| `38106f768` | 18/18 unit (~1.3s) | parser-equivalence — readOtlpBody / parseOtlpTraces / parseOtlpLogs / parseOtlpMetrics across all 4 encodings + JSON↔protobuf equivalence + JSON-then-protobuf fallback + module-resolution check |
| `f25d713ab` | 6/6 integration (~10s) | event_log durability — SpanReceivedEvent round-trip; ALTER TABLE DELETE leaves event_log intact; event-payload fidelity post-derived-view-deletion; cross-tenant isolation; ReplacingMergeTree idempotency on EventId |
| `0a2b7e8d9` | 8/8 integration (~7s) | ensureHiddenGovernanceProject — first-mint creates exactly one Project; idempotent sequential + 5-concurrent; fresh-admin no-team throw; cross-org tenancy; Layer-1 filter integration; traceSharingEnabled=false; slug-stable |
| `94426716e` | 2/2 integration (~7s) | Layer-1 hidden Gov Project filter at PrismaOrganizationRepository.getAllForUser |
| `9a5653107` | (cleanup fix) | Layer-1 invariant test cleanup-step organizationId fix |
| `d20a1b403` | 13/13 integration (~20s) | **End-to-end HTTP receiver proof** — POST → /api/ingest/{otel,webhook}/:sourceId. Verifies: 401 on bad/missing/cross-org Bearer; 400 wrong_endpoint on shape mismatch (log on /otel, span on /webhook); happy path stamps all 5 origin attrs on every span/log_record; caller attrs preserved; handleOtlpTraceRequest/handleOtlpLogRequest invoked with govProject.id as tenant; lastEventAt advances; idempotent across 3 posts |

Total Lane-S/A backend test coverage on the unified-trace direction: **47/47
passing** end-to-end. After receiver cutover the same tests remain green by
construction (the receiver reuses the parser + the event_log + the helper +
hands off to the existing trace/log pipeline).

> **In flight**: Lane-B Layer-2 per-consumer integration test against live
> Gov Project data; Lane-B governance UI dogfood + screenshots.

---

## Branch commit history — the unified-trace correction (this branch)

The architecture pivoted mid-branch from a parallel governance-event backend
(`gateway_activity_events` CH table + `activity-monitor-processing` event-sourcing
pipeline) to the unified-trace direction. Honest history:

| Commit | What landed |
|---|---|
| `f3de1ae07` | refactor(governance): rip out parallel activity-monitor backend (1/3) — mechanical delete of the wrong-direction artifacts. ~1,770 LOC removed. |
| `9ea0a26d6` | spec(governance): Lane-S BDD specs — receiver-shapes / folds / retention / event-log-durability |
| `5b8128b4b` + `16ad29abf` + `c202031a6` | spec(governance): Lane-A BDD specs — compliance-baseline + siem-export + cross-ref consolidation |
| `b3f488d76` + `cf4f58aab` | spec(governance): Lane-B BDD specs — ui-contract + architecture-invariants |
| `bdb137e6b` | feat(governance): schema for hidden Governance Project + per-origin retention class (2a) |
| `94426716e` | feat(governance): Layer-1 hidden Gov Project filter at getAllForUser + invariant test (Lane B) |
| `e2c30961a` | feat(governance): ensureHiddenGovernanceProject helper + retentionClass wire-in (2b-i) |
| `0d07ac371` | feat(governance): receiver rewire — OTLP traces → unified trace pipeline (2b-ii-a) |
| `33a8cf6d0` | feat(governance): webhook receiver — flat events → OTLP log_records (2b-ii-b) |
| `38106f768` | test(governance): parseOtlpBody parser-equivalence (Lane A) |
| `f25d713ab` | test(governance): event_log durability (Lane A) |
| `0a2b7e8d9` | test(governance): ensureHiddenGovernanceProject lazy-ensure invariants (Lane A) |
| `d20a1b403` | test(governance): end-to-end HTTP receiver — unified substrate proof through public API (Lane A) |
| `f9af3cb79` | fix(governance): TenantId branded-type casts in event_log durability test |
| `9a5653107` | fix(governance): Layer-1 invariant test cleanup-step organizationId fix |
| `fd118131c` | feat(governance): step 3a — read-side cutover onto unified trace store (ActivityMonitorService + setupState rewire) |
| `66c897a08` | test(governance): step 3a — ActivityMonitorService read-side integration test (7 scenarios + cross-org Layer-1) |
| `e709cfbc8` | test(governance): volume regression integration test — concurrent + cross-org (Lane A) |
| `769c67395` + `789c5cbb7` + `8073888bd` | feat(governance): step 3b-i — governance_kpis CH migration + ReplacingMergeTree per-trace ORDER BY revisions (Lane S) |
| `b54696d95` | feat(governance): step 3b-ii — governanceKpisSync reactor + CH repository + pipeline registration (Lane S) |
| `d2c544ec5` | test(governance): step 3b-iii — governanceKpisSync reactor unit tests (Lane S) |
| `9d2688c84` | feat(governance): add hasApplicationTraces flag to setupState — Persona-3 detection (Lane S) |
| `94426716e` (already listed earlier) | + Phase 1B.5 backports — covered above |
| `e40ee0045` | feat(governance): persona-aware home resolver (Lane B 1.5b-viii — 12 unit tests + BDD spec + tRPC + pages/index.tsx wire + regression invariant) |
| `b8b21bb79` | feat(cli): Storyboard Screen 4 login ceremony — try-it block + dashboard hint (Lane A 1.5a-cli-1) |
| `32cad11ae` | feat(governance): add api.user.cliBootstrap — Storyboard Screen 4 ceremony enrichment (Lane S) |
| `5c0816bb0` | refactor(governance): extract CliBootstrapService + add /api/auth/cli/bootstrap REST adapter (Lane S) |
| `d38ba422e` | feat(cli): wire api.user.cliBootstrap into Storyboard Screen 4 ceremony (Lane A 1.5a-cli-1 enrichment) |
| `3156b9e17` | feat(governance): step 3c-i — per-origin retention TTL on stored_spans + stored_log_records (Lane S — denormalized RetentionClass column + per-class TTL clauses, Option A consensus) |
| `629c50734` | feat(governance): step 3c-ii — RetentionClass write-side population in CH repositories (Lane S — denormalised from `langwatch.governance.retention_class` span/log attribute, mirrors SPAN_ATTR_MAPPINGS pattern) |
| `915d8def3` | fix(governance): actionable error message when device-flow approve hits no provider credentials (Lane B — UX bug surfaced + fixed inline during iter27 dogfood) |
| `8325a5262` | feat(governance): step 3c-iii — extend ttlReconciler to combine cold-storage + per-class DELETE TTL (Lane S — Option Y consensus, single MODIFY TTL clause preserves per-class retention on cold-storage-enabled installs) |
| `cb3702cd2` | test(governance): step 3c-iv — per-origin retention TTL integration test (Lane S — 7 scenarios covering write-side + table metadata invariants). **3c chain CLOSED end-to-end across both install modes (self-hosted no-cold + SaaS cold).** |
| `5fa23f900` | feat(governance): step 3d-i — governance_ocsf_events CH migration (Lane S — OCSF v1.1 / OWASP AOS shape Actor / Action / Target / Time / Severity / Event ID per `siem-export.feature` spec) |
| `ee5159879` | feat(governance): step 3d-ii — governanceOcsfEventsSync reactor + CH repository + pipeline registration (Lane S — populates the OCSF fold downstream of trace_summary fold; mirrors 3b-ii pattern) |
| `50ebe34b3` | test(governance): step 3d-iii — governanceOcsfEventsSync reactor unit tests, 13 cases (Lane S) |
| `220336f3f` | docs(governance): fold iter28 Screen 4 success ceremony + iter28 discoveries + 3d-i/3d-ii commit refs (Lane A) |
| `be89d872a` | fix(governance): defensive scope normalization in RoutingPolicyService.create (Lane B — dogfood-found) |
| `07bd07deb` | feat(governance): step 3f — OCSF export tRPC procedure for SIEM forwarding (Lane S — `api.governance.ocsfExport` cursor-paginated, org-tenancy isolation, auth-scoped) |
| `37f3a8b3e` | chore(docs): rename llms.txt.sh → llms.txt.cjs (Node 24 ESM-loader compat — pre-commit hook fix) |
| `1e34cd9ef` | docs(governance): wave 1 — flip `trace-vs-activity-ingestion.mdx` to unified-substrate framing per ADR-018 (Lane A) |
| `7cb933841` | chore(dogfood): `seed-anomaly-fixture.ts` for iter28-followup live-data pass (Lane B) |
| `3d2404170` | feat(governance): step 3e-i — `SpendSpikeAnomalyEvaluator` service (Lane S) |
| `f13c33e20` | docs(governance): wave 2 — NEW `compliance-architecture.mdx` (~165 LOC) + `retention.mdx` (~85 LOC) + `ocsf-export.mdx` (~120 LOC, locked against Sergey's 3f wire shape) (Lane A) |
| `4a4b806db` | feat(governance): step 3e-ii — scheduled anomaly-detection BullMQ worker + queue (every 5 min) (Lane S) |
| `b906d1c15` | test(governance): step 3e-iii — `SpendSpikeAnomalyEvaluator` 12 unit tests covering pure decision logic (Lane S) |
| `5bca796f2` | docs(governance): wave 3 — 8 ingestion-source pages reframed end-to-end with OTLP-shape table + sed-replaced stale terms (Lane A) |
| `0b4f4d90e` | docs(governance): wave 4 — `personal-keys.mdx` storyboard refresh: 40-second pitch + accurate `formatLoginCeremony` output + `langwatch request-increase` UX + cross-references to wave-2 pages (Lane A) |
| `3ecd1181d` | fix(governance): `seed-anomaly-fixture.ts` schema fix (config→thresholdConfig per AnomalyRule contract — would've blown up first 3e-iv re-run) (Lane B) |
| `a935d707e` | feat(governance): persona-aware chrome — /me uses `PersonalSidebar` + `WorkspaceSwitcher`. New 90-LOC component; `DashboardLayout` swaps `ProjectSelector→WorkspaceSwitcher` + `MainMenu→PersonalSidebar` on `isPersonalScopeRoute`; `MyLayout` shrinks (drops redundant in-page chip + 'MY WORKSPACE' eyebrow); `MainMenu` drops `hasIngestionSources` predicate (chicken-and-egg fix). Plus 197-LOC `persona-aware-chrome.feature` BDD spec (Lane B) |
| `b311d1ca5` | docs(governance): `persona-aware-chrome.feature` spec — fix FF table per two-flag lock (Govern→`release_ui_ai_governance_enabled`, Gateway→`release_ui_ai_gateway_menu_enabled`); FF-off scenarios split into two independent ones (Lane B) |
| `840377ace` | test(governance): step 3e-iv — `SpendSpikeAnomalyEvaluator` I/O integration test, 4/4 in 8s (covers happy/dedup/source-scope-mismatch/archived-rule-excluded; per-ruleId alert queries vs global counters for shared-test-PG determinism) (Lane S) |
| `385c95e89` | feat(rbac): add AI Governance permissions catalog (org-level) — 5 new Resources (`governance`, `ingestionSources`, `anomalyRules`, `complianceExport`, `activityMonitor`) × actions; ADMIN default-grant; MEMBER + EXTERNAL get nothing; read-only resources flagged in `permissionsConfig.ts`; 5 new test cases — 56/56 `rbac.test.ts` green (Lane S) |
| `043726430` | feat(governance): chrome gate uses `governance:view` permission — swaps the temporary `organization:manage` placeholder for the production `governance:view` check on the Govern sidebar entry; spec table updated to reflect production permission strings (Lane B) |

Earlier (pre-correction) commits on the branch are preserved for the audit
trail. The mechanical delete commit (`f3de1ae07`) is the boundary between
"old direction" and "unified-trace correction."

---

## What's still in flight

> Detailed atomic-task Gantt with all phases below in **§ Atomic-task Gantt**. This is the short list of "next slices to land before merge."

| Slice | Owner | State |
|---|---|---|
| `ActivityMonitorService` rewire onto trace_summaries + log_records with origin filter | Lane S | ✅ shipped `fd118131c` (step 3a) |
| Step 3a integration test (ingest → trace_summaries → ActivityMonitorService.summary) | Lane S | ✅ shipped `66c897a08` (7 scenarios + cross-org Layer-1) |
| `governance_kpis` fold projection (step 3b) | Lane S | ✅ shipped `769c67395` + `789c5cbb7` + `8073888bd` (migration revs) + `b54696d95` (reactor) + `d2c544ec5` (unit tests) + `e709cfbc8` (volume regression) |
| Per-origin retention TTL hook on recorded_spans + log_records (step 3c) | Lane S | ✅ shipped `3156b9e17` (3c-i migration) + `629c50734` (3c-ii write-side) + `8325a5262` (3c-iii ttlReconciler combine, Option Y) + `cb3702cd2` (3c-iv integration test) — chain CLOSED across self-hosted + SaaS cold-storage modes |
| `governance_ocsf_events` fold projection (step 3d) | Lane S | ✅ shipped `5fa23f900` (migration) + `ee5159879` (reactor + repo + pipeline reg) + `50ebe34b3` (13 unit tests) |
| Anomaly reactor — `SpendSpikeAnomalyEvaluator` + scheduled BullMQ worker (step 3e) | Lane S | ✅ shipped `3d2404170` (service) + `4a4b806db` (worker + queue) + `b906d1c15` (12 unit tests) + `840377ace` (3e-iv I/O integration test, 4/4 in 8s) |
| OCSF read tRPC procedure for SIEM forwarding (step 3f) | Lane S | ✅ shipped `07bd07deb` (`api.governance.ocsfExport`, cursor-paginated, org-tenancy isolation, auth-scoped to org admin / auditor) |
| **AI Governance RBAC permissions catalog** | Lane S | ✅ shipped `385c95e89` (5 new Resources × actions, ADMIN-only default, 56/56 `rbac.test.ts` green) |
| End-to-end HTTP receiver integration test | Lane A | ✅ shipped `d20a1b403` (13 tests) |
| Layer-2 per-consumer integration test | Lane B | superseded — Layer-1 + Andre's helper composition + UI dogfood cover the invariant |
| UI verification screenshots | Lane B | ✅ shipped — iter22 (8 screenshots, hosted via img402.dev) + iter29 persona-chrome dogfood (3 screenshots, hosted via img402.dev, embedded in §UI verification screenshots) |
| Customer-facing docs flip — 4 waves | Lane A | ✅ shipped — `1e34cd9ef` + `f13c33e20` + `5bca796f2` + `0b4f4d90e` |
| **Persona-aware chrome rework** | Lane B | ✅ shipped `a935d707e` (chrome refactor + new PersonalSidebar) + `b311d1ca5` (spec FF correction) + `043726430` (gate consumes `governance:view`) |
| Live-data dashboard dogfood | Lane B | ✅ shipped — 4 persona-chrome screenshots prove live data path |
| **License relocation: governance modules → `langwatch/ee/governance/`** (4a) | Lane S+B | ⏳ deferred to follow-up PR (rchaves directive: ship behavior in this PR, file relocation in a separate cosmetic-only PR) |
| **UI gating: enterprise-locked surfaces (3-tier) + service-layer 403 + CLI 402 envelope** (4b) | Lane S+B+A | ⏳ deferred to follow-up PR (paired with 4a) |
| **License-gate assertion test** (4c) | Lane S | ⏳ deferred to follow-up PR (paired with 4a) |
| **tRPC procedure permission granularization** (`organization:manage` → `governance:manage` per-route swap) | Lane S | ⏳ deferred to follow-up PR — existing checks still work; granularization is a separate sweep |

---

## Customer-facing surfaces touched by this PR

### Per-platform OTLP-shape mapping (what each source emits, where it lands)

Every governance ingest source picks its OTLP wire shape based on whether the upstream emits span-shaped agent activity or flat audit events:

| Source type | Delivery | OTLP shape | Storage | Drill-down UX | Today's capability |
|---|---|---|---|---|---|
| `otel_generic` | Push (HTTP/OTLP) | Spans | `recorded_spans` | Trace viewer | Production-ready |
| `claude_cowork` | Push (HTTP/OTLP) | Spans | `recorded_spans` | Trace viewer | Production-ready |
| `workato` | Webhook → OTLP logs | Logs | `log_records` | Log detail pane | Receiver works; per-platform deeper adapter (job-array unwrap) is follow-up |
| `s3_custom` | S3 replay + callback webhook | Logs | `log_records` | Log detail pane | Receiver works; S3 DSL parsing is follow-up |
| `copilot_studio` | Pull (worker, vendor API) | Logs | `log_records` | Log detail pane | Setup-contract-only; puller worker is follow-up |
| `openai_compliance` | Pull (worker, vendor API) | Logs | `log_records` | Log detail pane | Setup-contract-only; puller worker is follow-up |
| `claude_compliance` | Pull (worker, vendor API) | Logs | `log_records` | Log detail pane | Setup-contract-only; puller worker is follow-up |

**Why two shapes**: spans carry parent-child + duration + status — native fit for multi-step agent activity that benefits from drill-down in the trace viewer. Logs are flat: one event = one row, attributes carry the payload. Forcing flat audit feeds into the span shape requires synthetic `traceId`/`spanId`/duration that carry no information. **One internal pipeline either way** — both shapes pass through the same hardened OTLP parser (`langwatch/src/server/otel/parseOtlpBody.ts:57-159`) and the same trace pipeline downstream.

### Compliance posture (per-framework mapping for the auditor in the room)

| Framework | Coverage in this PR | Mechanism in LangWatch |
|---|---|---|
| **SOC 2 Type II** | ✅ Baseline | Append-only `event_log` (PR #3351 foundation) + per-origin retention class + RBAC via project membership + access logging + org-tenancy isolation |
| **ISO 27001** | ✅ Baseline | Same; documented control mapping (Annex A.12 logging, A.18 compliance) |
| **EU AI Act** (general-purpose tier) | ✅ Baseline | Audit trail durable in `event_log` + retention class meets logging requirements + non-repudiation |
| **GDPR** | ✅ Baseline | Right-to-be-forgotten honoured at retention boundary; org-tenancy isolation; auditor read-only role for DPO access |
| **HIPAA** (most uses) | ✅ Baseline | 7-year archive class (`seven_years`) + RBAC + `event_log` non-repudiation + org-tenancy isolation |
| **EU AI Act** (high-risk tier) | ⏳ Pending follow-up | Same baseline + cryptographic tamper-evidence (named, design locked in `compliance-baseline.feature`) |
| **HIPAA** (covered-entity strict / HITECH cryptographic verification) | ⏳ Pending follow-up | Same + tamper-evidence follow-up |
| **SEC 17a-4** (broker-dealer WORM) | ✗ Out of scope | Requires WORM storage layer + cryptographic verification beyond LangWatch's current model |

**Tamper-evidence is named, not abandoned**: the design (Merkle-root publication of `event_log` digests + customer-rotatable signing keys + verification REST API) is locked in `specs/ai-gateway/governance/compliance-baseline.feature` so it isn't reinvented when a named customer requirement lands. **Why deferred**: the baseline `event_log` already provides non-repudiation for SOC 2 / ISO 27001 / EU AI Act general-purpose / GDPR / HIPAA-most-uses without cryptographic publication; we're not over-engineering for hypothetical customers. **What we don't compromise**: the baseline ships in this PR, fully tested, fully spec'd. Tamper-evidence is the only deferred compliance scope.

### In-scope vs out-of-scope (deferral honesty)

| | This PR | Out of scope (named follow-ups) |
|---|---|---|
| **Architecture** | Unified observability substrate (recorded_spans + log_records); hidden Governance Project lazy-ensure; origin metadata; reserved namespaces | — |
| **Receivers** | OTLP/HTTP push + generic webhook → OTLP logs adapter (default minimum-shape mapper) | Per-platform deeper webhook adapters (workato job arrays, s3 DSL parsing, copilot_studio Purview shapes); pull-mode workers for copilot_studio + openai_compliance + claude_compliance |
| **Folds** | (Step 3/3, in flight) | governance_kpis + governance_ocsf_events on the unified store |
| **Anomaly reactor** | spend_spike Live; 6 other types Preview (composer accepts, reactor skips with debug log); log-only dispatch | C3 `triggerActionDispatch` (Slack / PagerDuty / SIEM webhook / email); structured threshold-config schema per rule type |
| **OCSF / SIEM** | (Step 3/3, in flight) | Per-org SIEM push UI; DLQ + replay; managed Splunk/Datadog HEC integrations |
| **Compliance** | SOC 2 Type II / ISO 27001 / EU AI Act general-purpose / GDPR / HIPAA-most-uses baseline | Cryptographic tamper-evidence (Merkle-root + signing keys + verification API) |
| **Retention** | Three classes (`thirty_days` / `one_year` / `seven_years`); CH TTL hook (Step 2c, in flight) | Per-source custom retention windows; org-plan ceiling enforcement |
| **UI** | Governance home + composer + secret-reveal modal + per-source detail (unified store) + anomaly composer + project-filter regression | Per-org SIEM push management UI; tamper-evidence verification UI |
| **CLI** | `langwatch governance status`; `langwatch ingest list/health/tail` (read-only) | `langwatch ingest mutate` writes; OCSF push trigger; tamper-evidence verify |
| **Tier 2 / Tier 5** | Control-plane primitives | BYOK endpoint routing runtime; sandboxed-runtime adapter |

### CLI ingest debug surface (lane-A)

Read-only governance debug helpers gated behind `LANGWATCH_GOVERNANCE_PREVIEW=1`. Same backend the web `/governance` and per-source detail page render, exposed via Bearer-auth REST adapters under `/api/auth/cli/governance/*`.

| Command | What it does | Backend |
|---------|--------------|---------|
| `langwatch governance status` | Org-level setup-state OR-of-flags (drives MainMenu Govern entry promotion) | `api.governance.setupState` |
| `langwatch ingest list [--all] [--json]` | Org's IngestionSources, active by default | `api.ingestionSources.list` |
| `langwatch ingest health <id> [--json]` | 24h / 7d / 30d events + lastSuccessIso | `api.ingestionSources.healthMetrics` |
| `langwatch ingest tail <id> [--limit N] [--follow] [--json]` | Stream events from unified store, dedup by spanId/eventId | `api.governance.eventsForSource` |

All `--json` modes contract-stable byte-for-byte with the equivalent tRPC procedure. `--follow` polls every 3s with cursor watermark + `seen` Set dedup.

### Documentation updates landed in this PR

- `docs/ai-gateway/overview` — 30-second curl with the new "Don't have a VK yet?" persona-fork callout
- `docs/ai-gateway/quickstart` — explicit developer / admin persona fork at the top
- `docs/ai-gateway/governance/{overview, control-plane, personal-keys, admin-setup, routing-policies, anomaly-rules, cli-debug}` — full governance reading order
- `docs/ai-gateway/governance/ingestion-sources/{index, otel-generic, claude-cowork, workato, s3-custom, copilot-studio, openai-compliance, claude-compliance}` — 8 per-platform pages with brutally honest **Production-ready / Receiver-works / Setup-contract-only** matrix
- `docs/observability/trace-vs-activity-ingestion` — disambiguation page (two URLs, ONE substrate, IngestionSource as origin metadata)

Plus the internal architecture decision record at [`dev/docs/adr/018-governance-unified-observability-substrate.md`](../dev/docs/adr/018-governance-unified-observability-substrate.md) (commit `53a5c4af9`) — captures the parallel-pipeline rip-out, the user directive that triggered it, the 6-point unified-substrate decision, 4 alternatives considered with rejection reasons, the per-source-type wire-shape table, the hidden Gov Project lifecycle diagram, and the branch-correction commit-trace from `f3de1ae07` through `33a8cf6d0`.

---

## UI flows + screenshots

> Captured by Alexis during the iter22 governance dogfood pass against the
> running dev server. All post-`33a8cf6d0` (full receiver rewire shipped).

### The unified-substrate dogfood path

The customer journey, captured frame-by-frame against the running dev
server post-`33a8cf6d0` (full receiver rewire shipped):

1. **`/governance` admin overview** — chrome + 3 KPI cards (SPEND 30D / ACTIVE USERS 30D / OPEN ANOMALIES 1) + 6 ingestion sources + 1 anomaly firing in Recent anomalies (live-data dogfood post-3a, post-Sergey ActivityMonitorService rewire). Org-scoped surface; the top-nav shows the "Organization-scoped — not tied to a project" indicator (iter 19 work) confirming the page is not gated on the active project context. **Updated (iter27): replaces the earlier iter22 $0/0 synthetic shot — KPI strip + Recent anomalies now flow from real `recorded_spans` + `log_records` + `governance_kpis` data.**
   ![Governance dashboard with live data](https://i.img402.dev/j0m3np49vm.png)

2. **`/settings/governance/ingestion-sources` list** — fleet management
   for the per-platform feeds. "+ Add source" CTA opens the composer.
   Active sources show last-event timestamps, status, and a Rotate
   secret affordance (24h grace window — old secret stays valid while
   the new one rolls out upstream).
   ![Ingestion sources list](https://i.img402.dev/sfmg6nsxbd.png)

3. **Add ingestion source composer** — opens as a right-edge Drawer
   per the platform's universal create/edit pattern (commit
   `746951769` — refactored from inline panel to Drawer per
   rchaves's directive 2026-04-27). Source-type dropdown, display
   name, description, and the **retention class dropdown** with three
   options gated by org plan ceiling — Operational (30 days,
   SOC 2 / ISO 27001 baseline) / Compliance (1 year, EU AI Act /
   GDPR / HIPAA-most-uses) / Long-form audit (7 years, regulated
   industry). **Crucially, NO Project field** — the hidden
   Governance Project is internal routing only, never
   user-configurable. Per `master_orchestrator` + `rchaves` directive
   2026-04-27.
   ![Ingestion source composer drawer](https://i.img402.dev/o7cplffzne.png)

4. **WorkspaceSwitcher BEFORE the helper fires** — only the
   user-visible "tes" application project appears under the "test"
   organization. Baseline state: no IngestionSource exists, no hidden
   Governance Project minted yet (the helper is lazy — feature-flag
   activation alone does not create one).
   ![Workspace switcher pre-helper](https://i.img402.dev/urj4u15h3y.png)

5. **SecretModal post-create** — one-time bearer reveal + copy-paste
   curl example. Notice the section heading reads "OTLP **ingestion**
   endpoint" (not "audit-event endpoint") and the caption explains
   "Spans push into the LangWatch trace store with this source's
   origin tag... If you are sending agent traces from your own
   LangWatch SDK, use `/api/otel/v1/traces` with your project API
   key — different auth, **same trace store**."
   This is the unified-substrate framing locked by the branch
   correction (commit `7cf097a22`) — explicitly NOT the
   parallel-audit-events framing the original direction implied.
   ![Secret modal post-create](https://i.img402.dev/2favdzd7k4.png)

6. **WorkspaceSwitcher AFTER `ensureHiddenGovernanceProject` fires** —
   the create-source flow just minted a real `Project.kind =
   "internal_governance"` row through Sergey's lazy-ensure helper. The
   dropdown is unchanged: still ONLY "tes" appears. The Layer-1
   filter at `PrismaOrganizationRepository.getAllForUser` (commit
   `94426716e`) hides the routing artifact from every user-visible
   Project surface — proven end-to-end through real DB state, not
   synthetic test data. **This is the hidden-Governance-Project
   non-leak invariant operating in live UI.**
   ![Workspace switcher post-helper](https://i.img402.dev/nmrpej53qr.png)

7. **Anomaly rules list** — `/settings/governance/anomaly-rules`.
   Critical / Warning / Info severity sections; one active rule each.
   Cross-link from the governance overview when the rule fires.
   ![Anomaly rules list](https://i.img402.dev/x7qg8aqgfq.png)

8. **AnomalyRule composer** — opens as a larger right-edge Drawer
   (size=lg, fits the JSON threshold editor + Alert destinations
   callout cleanly). Name + Severity + Description + Rule type +
   Scope + Threshold JSON. v1 ships `spend_spike` rule type +
   log-only dispatch; `rate_limit` / `after_hours` / Slack / PagerDuty
   / webhook / email destinations are explicitly **preview** in the
   composer copy (config persists, evaluation/dispatch in follow-up).
   Honest framing — no mocked-v0 surfaces per @rchaves "no mocks in
   UI" directive.
   ![Anomaly composer drawer](https://i.img402.dev/3sionqxgev.png)

### Screenshot cross-references — what each shot proves

| Shot | Proves | Spec scenario |
|---|---|---|
| 1. /governance dashboard | Org-scoped admin surface renders chrome + KPI strip + IngestionSources panel against live PG | `ui-contract.feature` "single governance surface" |
| 2. Ingestion sources list | Fleet management surface + per-source action affordances | `ingestion-sources.feature` list + rotation |
| 3. Composer | Retention-class dropdown with canonical enum values; NO project picker (Governance Project is internal routing only) | `ui-contract.feature` "composer offers retention class" + "no project picker" |
| 4. WorkspaceSwitcher pre-helper | Baseline state — no Gov Project exists | `architecture-invariants.feature` lazy-ensure semantics |
| 5. Secret modal post-create | Unified-substrate copy ("OTLP ingestion endpoint" + "different auth, same trace store"), not parallel-audit-events framing | `ui-contract.feature` SecretModal copy + commit `7cf097a22` revert |
| 6. WorkspaceSwitcher post-helper | Hidden Governance Project never leaks into user-visible Project surfaces, **proven against real DB state** | `architecture-invariants.feature` "hidden Gov Project never appears in user-visible Project surfaces" + Layer-1 filter at `getAllForUser` |
| 7. Anomaly rules list | AnomalyRule + AnomalyAlert read paths render against real PG state | `architecture-invariants.feature` AnomalyRule lifecycle |
| 8. Anomaly composer | Composer offers retention-class + scope + threshold; Preview-rule-type framing matches spec contract | `ui-contract.feature` composer scenarios |

### Persona-aware chrome dogfood (iter29 — post `a935d707e` + `043726430`)

The persona-aware home routing claim from 1.5b-viii (`e40ee0045`) was scoped only to the URL redirect — the chrome (sidebar + selectors) remained LLMOps-default. iter29 dogfood under @rchaves review surfaced the gap: a personal-only user landing at `/me` saw two stacked selectors + an irrelevant LLMOps sidebar + "My Usage" buried as a sub-page.

Cross-lane fix shipped in 4 commits (`a935d707e` + `b311d1ca5` + `385c95e89` + `043726430`); 3 live-data screenshots prove the chrome works end-to-end. Hosted via img402.dev (7-day free tier; same pattern as iter22 shots above):

| Shot | Proves | Image |
|---|---|---|
| 9. /me with PersonalSidebar | Persona-1 chrome — ONE chip in header (`My Workspace ▼`), PersonalSidebar with "My Usage" + "Settings" only, NO ProjectSelector, NO redundant in-page chip, NO 'MY WORKSPACE' eyebrow header (literal gateway.md Screen 6 layout) | ![persona-1 /me chrome](https://i.img402.dev/jhzp1bqwql.png) |
| 10. Admin home with Govern + Gateway | Persona-4 chrome — admin lands on project context with full LLMOps sidebar + Govern (Preview) + Gateway (Beta) sections both visible (admin role + 2 FFs on) | ![persona-4 admin home](https://i.img402.dev/vtjtf3wj7o.png) |
| 11. /governance with org-scope chrome | Persona-4 governance home — org chip ("Acme P4") + "Organization-scoped" banner + Govern active in sidebar + setup checklist (define routing policy / connect ingestion source / anomaly rules) visible to admin **without any IngestionSource yet** — chicken-and-egg gate fix VALIDATED | ![persona-4 /governance](https://i.img402.dev/rtulyk7esy.png) |

The AI Gateway product-surface screenshot (originally planned as #12) is already covered by iter22 shots #1–#10 above (VK list / drawer / detail / usage / audit / providers / cache rules / budgets) — a single chrome shot of that surface would be redundant. The chrome rework's ship-claim rests on the 3 shots above.

**Regression-safety invariant locked**: Persona-3 (LLMOps majority — ~90% of users today, no AI gateway) sees ZERO chrome change. `DashboardLayout` is untouched for `project_only` persona. Codified in `persona-aware-chrome.feature` as the FIRST scenario in the file.

---

## License model — open-core split (Apache 2.0 + `ee/`)

> Per rchaves directive 2026-04-28: LangWatch is moving from BSL to **Apache 2.0** for the open-core surface, with enterprise modules under `langwatch/ee/` carrying a separate Enterprise license. This section captures the cross-lane consensus on **what stays open** vs **what moves to `ee/`** for the governance pillar this PR introduces. Cross-lane sources: lane-S (Sergey) + lane-B (Alexis at `.monitor-logs/lane-b-license-split-input.md`) + lane-A (Andre, this fold).

### Decision framework

A feature ships **Apache 2.0** when *any* of: (1) solo developer / small team gets standalone value without enterprise admin features; (2) trivial to rebuild (1–2 weeks for a determined competitor); (3) GTM viral surface devs install + tell colleagues about.

A feature ships **`ee/`** when *any* of: (1) compliance / governance is the customer-stated value (SOC2 / HIPAA / EU AI Act framework reports, retention class, SIEM export); (2) cross-source / cross-team / cross-org scale is the value (multi-source ingestion fleet, anomaly detection fleet, org-wide rollups); (3) high enterprise-glue cost (SCIM provisioning, revocation automation against vendor admin APIs); (4) lawsuit risk if a competitor copies it verbatim into their commercial product.

### Apache 2.0 floor — the trial wedge

A self-hosted free-tier user gets:

- One organization, one Personal Team, one Personal Project
- One personal Virtual Key with default RoutingPolicy
- **One IngestionSource of type `otel_generic`** with retention `thirty_days`
- `/governance` dashboard with **basic per-source widgets** (single-source spend, single-source events; no anomaly count, no cross-source rollup, no compliance posture)
- `langwatch` CLI with login + claude/codex/cursor/gemini/shell wrappers
- `/api/otel/v1/traces` SDK ingest unchanged

**The open-source demo loop closes end-to-end on Apache 2.0**: install → `langwatch login` → `langwatch claude` → `/governance` shows the basic OTel ingest. Maps to the GitLab CE / Sentry OSS / Grafana OSS pattern.

### What stays Apache 2.0 (open core)

| Feature | Where | Why open |
|---|---|---|
| Gateway proxy core (Bifrost-embedded routing/policy/budget) | `services/aigateway/` + `langwatch/src/server/governance/routing-policies/` | Trivial to rebuild; viral surface |
| Personal Virtual Keys + per-(user/team/project) GatewayBudget primitives | `langwatch/src/server/api/routers/virtualKeys.ts` | Per-dev API key minting; small team value |
| `langwatch` CLI binary + `login`/`claude`/`codex`/`cursor`/`gemini`/`shell` commands | `typescript-sdk/src/cli/` | Personal IDE-keys experience; the GTM viral surface |
| OTel SDK ingest via `/api/otel/v1/traces` + `/api/otel/v1/logs` | `langwatch/src/server/routes/otel.ts` | Existing apache2-equivalent; the open trace pipeline |
| **Governance ingest receivers** (`/api/ingest/{otel,webhook}/:sourceId`) — transport only | `langwatch/src/server/routes/ingest/ingestionRoutes.ts` | The trial wedge needs the receiver itself open. Service layer gates the *features* (multi-source, retention tiers); the HTTP path is just transport. |
| **`ensureHiddenGovernanceProject` helper** | `langwatch/src/server/governance/governanceProject.service.ts` | Substrate primitive called by the apache2 receiver. No-op for orgs with zero IngestionSources. |
| **`IngestionSourceService` with service-layer gate** | `langwatch/src/server/governance/activity-monitor/ingestionSource.service.ts` | Service stays apache2; `createSource` enforces: non-enterprise orgs limited to **1 source max**, **`sourceType = otel_generic` only**, **`retentionClass = thirty_days` only**. Single 403 boundary for all gating. |
| **`ActivityMonitorService` — basic per-source widgets** (`summary`, `ingestionSourcesHealth`, `eventsForSource`) | `langwatch/src/server/governance/activity-monitor/activityMonitor.service.ts` | Cross-source aggregations + anomaly rollups split to `activityMonitor.enterprise.service.ts` in `ee/`; basic surface stays apache2. |
| `setupState.service.ts` (persona-detection probe) | `langwatch/src/server/governance/setupState.service.ts` | Substrate primitive; drives free-tier nav promotion |
| Personal "My Usage" dashboard | `langwatch/src/components/dashboard/PersonalUsage*` | Solo-dev value |
| Single-project trace viewer + log detail pane | `langwatch/src/components/messages/` | Existing core LangWatch |
| `/governance` dashboard shell + basic-only widgets | `langwatch/src/components/governance/GovernanceDashboard.tsx` | Trial wedge surface |
| Schema: `Project.kind`, `IngestionSource.retentionClass`, `IngestionSource` model itself, `AnomalyRule`/`AnomalyAlert` models | `langwatch/prisma/schema.prisma` | Schemas are no-op when no rows exist. Service-layer gate, not Prisma multi-schema. |
| Shared OTLP body parser (`parseOtlpBody.ts`) | `langwatch/src/server/otel/parseOtlpBody.ts` | Used by both `/v1/traces` and governance receivers; single source of truth |
| `event_log` + projection pipeline (PR #3351) | `langwatch/src/server/event-sourcing/` | Existing core durability foundation |
| Layer-1 `Project.kind` filter at `getAllForUser` | `langwatch/src/server/app-layer/organizations/repositories/organization.prisma.repository.ts` | Filter is a no-op when no `internal_governance` projects exist; defensive correctness |
| SPAN_ATTR_MAPPINGS hoisting `langwatch.origin.*` + `langwatch.governance.*` keys | `langwatch/src/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection.ts` | Forward-compatible no-op when no governance traffic flows |

### What moves to `ee/governance/` (Enterprise license)

Mirroring the existing `langwatch/ee/{admin,billing,licensing,managed-providers,saas}/` layout. Net relocation: ~6 backend files + their tests + ~8 UI surfaces.

| Feature | From | To | Why enterprise |
|---|---|---|---|
| Multi-source-type expansion (`workato` / `claude_cowork` / `s3_custom` / `copilot_studio` / `openai_compliance` / `claude_compliance`) — gated at `IngestionSourceService.createSource` | `langwatch/src/server/governance/activity-monitor/` | `langwatch/ee/governance/ingestion/` | Multi-source fleet is the enterprise pricing axis |
| `ActivityMonitorService` cross-source aggregations + anomaly rollups | (split from existing) | `langwatch/ee/governance/activity-monitor/activityMonitor.enterprise.service.ts` | Cross-source rollup = enterprise UX |
| `AnomalyRuleService` + `anomalyRule.router` (composer + reactor + dispatch) | `langwatch/src/server/governance/anomaly/` | `langwatch/ee/governance/anomaly/` | Enterprise muscle |
| Anomaly dispatch destinations (Slack / PagerDuty / email / webhook) | (planned C3) | `langwatch/ee/governance/anomaly/dispatch/` | Pure enterprise glue |
| `governance_kpis` + `governance_ocsf_events` fold projections (3b/3d) | (planned) | `langwatch/ee/governance/folds/` | Enterprise read-side primitives |
| Per-origin retention TTL hook (3c) — `one_year` + `seven_years` tiers | (planned) | `langwatch/ee/governance/retention/` | Compliance-driven retention |
| OCSF v1.1 read API + thin push wrapper (3f) | (planned) | `langwatch/ee/governance/ocsf-export/` | "Pull governance into your SIEM" pricing axis |
| Compliance posture report generator (SOC2 / ISO27001 / EU AI Act framework cross-mapping) | (planned) | `langwatch/ee/governance/compliance/` | Compliance reporting = enterprise ask |
| SCIM provisioning + per-user Anthropic key flow | `langwatch/ee/admin/scim/` | unchanged | Already in ee/ |
| Revocation automation (vendor admin APIs) | (planned C3+) | `langwatch/ee/governance/revocation/` | Enterprise glue, lawsuit-attractive |
| Governance dashboard advanced widgets (multi-source rollup, anomaly count, compliance dial) | (split from existing) | `langwatch/ee/governance/dashboard/` | Cross-source rollup view = enterprise UX |
| AnomalyRule composer + alert-destinations + compliance-posture + ocsf-export pages | `langwatch/src/components/governance/` | `langwatch/ee/governance/dashboard/` | Enterprise UI surfaces |
| All 8 BDD specs `specs/ai-gateway/governance/*.feature` | unchanged path | unchanged | Specs document the contract; relocation cosmetic — keep where reviewers expect them |

### UI gating pattern — 3 tiers (Alexis)

> Per rchaves directive: "*always just grayed out on the frontend, allowing them to see it exists but being blocked.*"

**Tier UI-1 — visible-but-locked surface (default)**: render the page chrome, table, composer button, empty state. Every interactive control disabled with an "Enterprise" inline badge. Persistent overlay banner: *"This is an Enterprise feature. You can preview it here. Contact sales to unlock."* Component: new `<EnterpriseLockedSurface tier="anomaly-rules">` wrapper, ~1-line per page.

**Tier UI-2 — visible-with-disabled-options (mixed surfaces)**: surfaces where some options are apache2 and some are ee/. Example: IngestionSource composer's Source Type dropdown — `otel_generic` selectable, the other 6 grayed-out with `(Enterprise)` badge + tooltip. Extension to existing Chakra `<Select>` adapter, ~30 LOC.

**Tier UI-3 — hidden (rare)**: low-level ops controls that depend on ee-only data plane and would confuse free-tier users (retention TTL knob, OCSF schema selector, cache rules). Conditional render behind `useActivePlan().isEnterprise`. Use sparingly — UI-1 converts; UI-3 doesn't.

### 18-surface UI license inventory (Alexis)

| URL | License | Tier | Notes |
|---|---|---|---|
| `/me` (personal usage) | apache2 | — | Solo-dev wedge |
| `/me/settings` (PAT + budget readonly + devices) | apache2 | — | Free-tier essential |
| `/[project]/settings/virtual-keys` | apache2 | — | Per-project VK CRUD |
| `/[project]/settings/budgets` | apache2 | — | Per-project / per-VK / per-principal budgets |
| `/[project]/settings/audit` | apache2 | — | Per-project audit log |
| `/settings/routing-policies` | apache2 | — | Org-default + team-overrides |
| `/settings/model-providers` | apache2 | — | Org/Team/Project provider scoping |
| `/settings/usage` (subscription) | apache2 | — | Upgrade-CTA deep-link target |
| `/governance` (top-level dashboard) | mixed | UI-1 base + UI-2 widgets | Apache2 shell + basic widgets; ee/-gated multi-source rollups + anomaly count |
| `/settings/governance/setup` | apache2 | — | Free shows OTel + Personal-VK steps; ee/ steps behind "More with Enterprise →" disclosure |
| `/settings/governance/ingestion-sources` | mixed | UI-2 on composer | List apache2 (1 source); composer source-type dropdown UI-2 |
| `/settings/governance/anomaly-rules` | ee/ | UI-1 wrap | Visible+locked. Composer schema visible to free user; create disabled |
| `/settings/governance/alert-destinations` | ee/ | UI-1 wrap | Same |
| `/settings/governance/compliance-posture` | ee/ | UI-1 wrap | Framework matrix grayed out |
| `/settings/governance/ocsf-export` | ee/ | UI-1 wrap | OCSF schema preview visible; activation locked |
| `/settings/governance/retention-policies` | ee/ | UI-3 hidden | Free-tier retention is fixed at `thirty_days`; the knob doesn't exist |
| `/settings/governance/cache-rules` | ee/ | UI-1 wrap | iter38/iter41 shipped — gate retroactively |
| `/settings/groups` + `/settings/roles` | ee/ | UI-1 wrap | Existing early-return — refactor candidate |
| `/settings/scim` | ee/ | UI-1 wrap | When personal-key SCIM ships |
| `/settings/audit` (org-wide) | ee/ | UI-1 wrap | Per-project audit apache2; org-wide ee/ |

### CLI gating

The `langwatch` CLI binary stays apache2 (single binary; viral install surface). Subcommands that hit enterprise-only endpoints (`langwatch ingest list/health/tail` for ee/-only sources, `langwatch governance status` showing enterprise widgets) get **402 Payment Required** envelopes from `/api/auth/cli/governance/*` for non-enterprise orgs:

```json
{
  "error": "enterprise_required",
  "feature": "governance.multi_source_ingestion",
  "upsell_url": "https://app.langwatch.ai/settings/usage"
}
```

The CLI prints a friendly upsell message + the URL. No CLI binary split.

### License-flip transition

Two votes deferred to rchaves resolution (tagged at end of PM round-up below):

- **Vote D**: Personal-key SSO (SCIM auto-provisioning of personal teams + policies) — apache2 vs `ee/`? Lane-A and lane-B lean apache2; precedent (GitLab CE) puts SAML in CE and SCIM/group-sync in EE. Defer to rchaves's call.
- **Vote F**: BSL → Apache 2.0 license-flip TIMING — same PR as governance ee/ relocation, or separate prep PR landing first? Defer to rchaves's call (legal/strategy).

---

## Atomic-task Gantt — done / in-flight / next / GA

> Atomic split of all work the team has done and will do, mapped to the gateway.md vision (Directions 1/2/3 + Phases 1A → 3D) and to the new license-relocation phase 4. Cross-lane sources: lane-S backend Gantt (Sergey) + lane-B UI roadmap (Alexis) + lane-A docs/PR/CLI Gantt (Andre).

**Legend**: ✅ shipped · 🚧 in flight · ⏳ next (queued + ready to start) · 📋 backlog (post-GA / larger follow-up)
**Lane prefix**: 🅐 lane-A (CLI/docs/PM) · 🅢 lane-S (backend) · 🅑 lane-B (UI/dogfood) · 🌐 cross-lane

### Phase 1A — Personal IDE keys (Direction 1, P0) — APACHE 2.0

| | Owner | Task |
|---|---|---|
| ✅ | 🅢 | `Project.isPersonal` + `Team.isPersonal` schema |
| ✅ | 🅢 | `VirtualKey.ownerType` polymorphic owner pattern |
| ✅ | 🅢 | Auto-create personal Team on user org-join |
| ✅ | 🅢 | `virtualKey.issuePersonal()` endpoint |
| ✅ | 🅐 | CLI binary: `langwatch login --device` (device-flow auth) |
| ✅ | 🅐 | CLI: `langwatch claude` / `codex` / `cursor` / `gemini` wrappers |
| ✅ | 🅐 | CLI: `langwatch shell` env-var injection + `logout-device` + `me` + `init-shell` |
| ✅ | 🅑 | "My Usage" personal dashboard |
| ✅ | 🅐 | Per-CLI-tool docs (claude-code/codex/cursor/gemini-cli with wrapper sections) |
| ⏳ | 🅐 | Single-binary installers (`curl ... \| sh` / Homebrew tap / PowerShell `iex`) |

### Phase 1B — Polish (Direction 1, P1) — APACHE 2.0

| | Owner | Task |
|---|---|---|
| ✅ | 🅐 | Persona fork on `/ai-gateway/quickstart` (developer vs admin) |
| ✅ | 🅑 | Fresh-admin reachability fix (`99dbc77e8`) |
| ✅ | 🅑 | GovernanceLayout chrome (org chip + "Organization-scoped" indicator) |
| ⏳ | 🅢 | Token refresh background job for CLI device-flow tokens |
| ⏳ | 🅢 | Per-user budget enforcement (cascading strictest-wins) |
| ⏳ | 🅑 | Admin user-activity report (cross-team) |

#### Phase 1B.5 — Jane-at-Acme storyboard polish + persona-aware home (NEW per rchaves directive 2026-04-29)

The Jane at Acme 8-screen storyboard from `gateway.md` is the **trial-wedge demo loop** that closes enterprise sales. Most surfaces are already shipped; this slice is polish + the persona-aware `/` redirect + screenshots. **Full storyboard + per-screen audit + persona-home model below in §Personal-Key Journey.**

| | Owner | Task |
|---|---|---|
| 🚧 | 🅑 | 1.5b-i: Live-data Playwright dogfood + screenshots — Screens 1 / 3 / 5 wireable today; first batch (3 shots) captured against running dev server |
| ⏳ | 🅑 | 1.5b-ii: Screen 2 — single-input email-only `/signin-cli` variant (vs full-provider-list /signin) |
| ⏳ | 🅑 | 1.5b-iii: Screen 4 — "You're in!" ceremony page redesign + close-tab CTA + provider+budget summary |
| ⏳ | 🅑 | 1.5b-iv: Screen 6 — `/me` layout refresh — *scope reduced ~3x post-iter27 audit: layout already production-ready; minor polish only* |
| ⏳ | 🅑 | 1.5b-v: Screen 7 — `/me/settings` polish — *scope reduced ~3x post-iter27 audit: managed-by-your-company chrome already in place; minor polish only* |
| ⏳ | 🅑 | 1.5b-vi: Screen 8 — `BudgetExceededBanner` web-side enrichment to match storyboard tone |
| ✅ | 🅑 | 1.5b-vii: WorkspaceSwitcher v2 — Personal/Team/Project visual + "managed by your company" indicator (already storyboard-shape; verified iter29) |
| ✅ | 🅑 | 1.5b-viii: Persona resolver service + `/` redirect + tRPC router + regression test — `e40ee0045` (12/12 unit tests, BDD spec, regression invariant for LLMOps majority locked) |
| ✅ | 🅑 | 1.5b-ix: BDD spec `persona-home-resolver.feature` (shipped with `e40ee0045`) |
| ✅ | 🅑 | 1.5b-x: Live-data dogfood post-resolver — 3 persona-chrome screenshots uploaded to img402.dev + embedded inline in §UI verification screenshots (persona1-me-personal, persona4-admin-home, persona4-governance) |
| ✅ | 🅑 | **1.5b-xi: Persona-aware chrome rework** — initial 1.5b-viii resolver shipped routing only; iter29 dogfood surfaced chrome was unchanged (two-selector bug, irrelevant LLMOps sidebar on /me). Cross-lane fix: `a935d707e` (PersonalSidebar + DashboardLayout chrome swap + MyLayout shrink + chicken-and-egg gate fix) + `b311d1ca5` (BDD spec FF correction, two-flag shape) + `043726430` (gate consumes `governance:view` permission post-rbac.ts catalog) + 197-LOC `persona-aware-chrome.feature` BDD spec |
| ✅ | 🅢 | **1.5s-rbac: AI Governance RBAC permissions catalog** — `385c95e89` (5 new Resources × actions in `rbac.ts`; ADMIN default-grant; MEMBER + EXTERNAL get nothing; `CustomRolePermissions` JSON column = the production-shape delegation surface) |
| ✅ | 🅢 | 1.5s: `setupState.hasApplicationTraces` flag — `9d2688c84` (consumed by 1.5b-viii via `api.governance.setupState`) |
| ✅ | 🅐+🅢 | 1.5a-cli-1: CLI Screen 4 ceremony — `b8b21bb79` (formatLoginCeremony helper, 15 unit tests) + `32cad11ae` (api.user.cliBootstrap tRPC) + `5c0816bb0` (CliBootstrapService extract + REST adapter) + `d38ba422e` (CLI fold-in via getCliBootstrap, 4 new unit tests). End-to-end rich Screen 4 ceremony (providers + budget) live on this branch. |
| ✅ | 🅐 | 1.5a-cli-2: CLI Screen 8 budget-limit-reached + `langwatch request-increase` (existing — `commands/request-increase.ts` + `utils/governance/budget.ts` `renderBudgetExceeded` + `checkBudget` pre-exec probe + 16 unit tests). *Audit gap caught — was already shipped before Phase 1B.5 fold.* |
| ✅ | 🅐 | 1.5a-docs: Customer-facing docs flip COMPLETE — 4 waves: wave 1 `1e34cd9ef` (`trace-vs-activity-ingestion.mdx` reframed) + wave 2 `f13c33e20` (NEW `compliance-architecture.mdx` + `retention.mdx` + `ocsf-export.mdx`) + wave 3 `5bca796f2` (8 ingestion-source pages reframed) + wave 4 `0b4f4d90e` (`personal-keys.mdx` storyboard refresh with 40-second pitch + `formatLoginCeremony` output + `langwatch request-increase` UX + cross-references to wave-2 pages) |
| ⏳ | 🅐 | 1.5a-marketing: Marketing-page outline for the open-core / personal IDE keys offering — gitignored draft at `.monitor-logs/lane-a-marketing-outline-draft.md` (~250 LOC, 9-section structure: hero / pain / solution / how-it-works / features / compliance / open-core pitch / pricing / footer CTA). Lives in `.monitor-logs/` until rchaves picks the home (probably the langwatch.ai marketing repo). |

### Phase 2A — Multi-source ingestion (Direction 2, P1) — UNIFIED SUBSTRATE (mostly Apache 2.0; multi-source fleet `ee/`)

| | Owner | Task |
|---|---|---|
| ✅ | 🌐 | 8 BDD specs locking architecture invariants |
| ✅ | 🅢 | Mechanical delete of parallel `gateway_activity_events` pipeline (`f3de1ae07`) |
| ✅ | 🅢 | Shared OTLP parser extracted (`d62fa1c41`) |
| ✅ | 🅢 | Schema: `Project.kind`, `IngestionSource.retentionClass` (`bdb137e6b`) |
| ✅ | 🅑 | Layer-1 hidden Gov Project filter at `getAllForUser` (`94426716e`) |
| ✅ | 🅢 | `ensureHiddenGovernanceProject` helper + composer wire-in (`e2c30961a`) |
| ✅ | 🅢 | OTel receiver rewire to unified pipeline (`0d07ac371`) |
| ✅ | 🅢 | Webhook receiver rewire to unified log pipeline (`33a8cf6d0`) |
| ✅ | 🅑 | Composer drawer migration + screenshot recapture (`746971569` + `bfafe764f`) |
| ✅ | 🅐 | parseOtlpBody parser-equivalence test, 18 unit (`38106f768`) |
| ✅ | 🅐 | event_log durability test, 6 integration (`f25d713ab`) |
| ✅ | 🅐 | `ensureHiddenGovernanceProject` lazy-ensure invariants test, 8 integration (`0a2b7e8d9`) |
| ✅ | 🅐 | HTTP receiver end-to-end test, 13 integration (`d20a1b403`) |
| ✅ | 🅐 | ADR-018 governance unified observability substrate (`53a5c4af9`) |
| ✅ | 🅢 | ActivityMonitorService rewire onto trace_summaries + log_records (step 3a, `fd118131c`) |
| ✅ | 🅢 | Step 3a integration test — 7 scenarios + cross-org Layer-1 (`66c897a08`) |
| ✅ | 🅢 | Step 3b: `governance_kpis` fold projection — `769c67395` migration + revisions + `b54696d95` reactor + `d2c544ec5` unit tests + `e709cfbc8` volume regression |
| ✅ | 🅢 | Step 3c: Per-origin retention TTL hook — `3156b9e17` (3c-i migration) + `629c50734` (3c-ii write-side) + `8325a5262` (3c-iii cold-storage combine via ttlReconciler) + `cb3702cd2` (3c-iv integration test). Chain closed end-to-end across both install modes. |
| ✅ | 🅢 | Step 3d: `governance_ocsf_events` fold projection — `5fa23f900` migration + `ee5159879` reactor + `50ebe34b3` unit tests |
| ✅ | 🅢 | Step 3e: `SpendSpikeAnomalyEvaluator` + scheduled BullMQ worker — `3d2404170` (service) + `4a4b806db` (worker) + `b906d1c15` (12 unit tests) + `840377ace` (3e-iv I/O integration test, 4/4 passing in 8s) |
| ✅ | 🅢 | Step 3f: OCSF v1.1 read tRPC procedure for SIEM forwarding — `07bd07deb` (cursor-paginated, org-tenancy isolation) |
| ✅ | 🅢 | AI Governance RBAC permissions catalog — `385c95e89` (5 new Resources, ADMIN default-grant, custom-role JSON for delegation) |
| ✅ | 🅑 | Live-data dashboard dogfood pass — 3 persona-chrome screenshots embedded inline in §UI verification screenshots (img402.dev hosted) |
| ✅ | 🅐 | Customer-facing docs flip — 4 waves shipped (`1e34cd9ef` wave 1 + `f13c33e20` wave 2 + `5bca796f2` wave 3 + `0b4f4d90e` wave 4) |

### Phase 4 — License relocation + UI gating (NEW per rchaves directive 2026-04-28)

| | Owner | Task |
|---|---|---|
| 🚧 | 🅐 | This PM proposal (license split + Gantt + product roundup) |
| 🚧 | 🌐 | Cross-lane review of license-split + Gantt; pushback / consolidation |
| 🚧 | 🅐 | Fold license-split + Gantt into PR-3524-DESCRIPTION.md (THIS COMMIT) |
| ⏳ | 🅢 | 4a-1: `git mv` ingestion + helper + activity-monitor (cross-source split) → `langwatch/ee/governance/` |
| ⏳ | 🅢 | 4a-2: `git mv` anomaly + folds (3b/3d) + retention (3c) + ocsf-export (3f) → `langwatch/ee/governance/` |
| ⏳ | 🅑 | 4a-3: `git mv` governance UI components → `langwatch/ee/governance/dashboard/` |
| ⏳ | 🅑 | 4b-1: New `<EnterpriseLockedSurface>` + `<EnterpriseLockedKpi>` components consuming `useActivePlan().isEnterprise` |
| ⏳ | 🅑 | 4b-2: Wire UI-1 wrap on anomaly-rules / alert-destinations / compliance-posture / ocsf-export / cache-rules / groups / roles / scim / org-wide-audit |
| ⏳ | 🅑 | 4b-3: Wire UI-2 source-type dropdown gate on IngestionSource composer |
| ⏳ | 🅢 | 4b-4: Service-layer 403 at `IngestionSourceService.createSource` (1 source / `otel_generic` only / `thirty_days` only for non-enterprise) |
| ⏳ | 🅢 | 4b-5: Service-layer 403 at every `api.governance.*` proc that reads ee/-only data |
| ⏳ | 🅐 | 4b-6: CLI 402 Payment Required envelope from `/api/auth/cli/governance/*` for non-enterprise; CLI prints upsell |
| ⏳ | 🅐 | 4b-7: Docs `docs/ai-gateway/governance/index.mdx` adds "Available on Enterprise plans" callout |
| ⏳ | 🅢 | 4c-1: License-gate assertion test — non-enterprise org → 403 on every `api.governance.*` proc + receiver service-layer gates respected |
| ⏳ | 🌐 | 4c-2: License headers — Apache 2.0 in `langwatch/src/`; Enterprise license in `langwatch/ee/` (per existing convention) |
| ⏳ | 🅐 | 4c-3: Top-level `LICENSE` + `LICENSE-EE` files clarifying the split |
| ⏳ | 🅐 | 4c-4: README.md update with open-core split + Apache 2.0 / Enterprise badges |

### Phase 2C — Anomaly action layer (Direction 2, P2) — `ee/`

| | Owner | Task |
|---|---|---|
| ✅ | 🅢 | `spend_spike` Live rule type |
| ✅ | 🅑 | Composer trim — Preview-rule-types framing (`c4ea7bd60`) |
| ⏳ | 🅢 | C3 dispatch: `triggerActionDispatch` (Slack / PagerDuty / SIEM webhook / email) |
| ⏳ | 🅢 | Structured threshold-config schema per rule type |
| 📋 | 🅢 | Live: `rate_limit`, `after_hours`, `pii_leak`, `unusual_actor` rule types |
| 📋 | 🅢 | Revocation automation: Anthropic Admin API |
| 📋 | 🅢 | Revocation automation: OpenAI Admin API |
| 📋 | 🅢 | Revocation automation: Microsoft Power Platform |
| 📋 | 🅢 | Revocation automation: Workato |

### Phase 2D — Pull-mode connectors (Direction 2, P2) — `ee/`

| | Owner | Task |
|---|---|---|
| ✅ | 🅢 | `copilot_studio` / `openai_compliance` / `claude_compliance` setup-contract-only |
| ⏳ | 🅢 | `copilot_studio` puller worker |
| ⏳ | 🅢 | `openai_compliance` puller worker |
| ⏳ | 🅢 | `claude_compliance` puller worker |
| ⏳ | 🅢 | Per-platform deeper webhook adapter: workato job-array unwrapping |
| ⏳ | 🅢 | Per-platform deeper webhook adapter: s3_custom DSL parsing |

### Phase 5 — GTM & release-readiness (round-up)

| | Owner | Task |
|---|---|---|
| ⏳ | 🅢 | Volume regression test: 1k spans/sec sustained for 60s through `/api/ingest/otel/:sourceId` (Sergey-flagged hot-path: `ensureHiddenGovernanceProject` `findFirst` per-request needs cache) |
| ⏳ | 🅢 | Cross-org concurrency test: 50 orgs × 100 concurrent first-mints |
| ⏳ | 🅢 | Reactor backpressure test: when 3b/3e land, anomaly + governance_kpis + trace-summary all share trace-processing pipeline |
| ⏳ | 🅢 | CH retention TTL atomicity test: span without retention attr (bug) defaults to 30d → wrong tier for `seven_years` source. Need TTL-mismatch alarm |
| ⏳ | 🅢 | Receiver auth rate limiting (per-source Redis-token-bucket RPS limit) |
| ⏳ | 🅢 | OCSF schema versioning column on the fold for graceful v1.1 → v1.2 upgrade |
| ⏳ | 🅑 | Browser-QA pass on enterprise-gating: every governance surface verified to gray-out for non-enterprise plan |
| ⏳ | 🅐 | Self-hosted compliance docs (`docs/self-hosting/compliance.mdx`) — what works in self-hosted Apache 2.0 vs requires Enterprise license |
| ⏳ | 🅑 | Cross-org isolation smoke at HTTP receiver layer (orgA bearer can't read orgB sources) |
| ⏳ | 🌐 | End-to-end customer dogfood smoke test (mint org → mint source → POST OTel → trace viewer + dashboard light up + Layer-1 non-leak) — automated in CI |
| ⏳ | 🌐 | CodeRabbit / reviewer pass on `feat/governance-platform` PR before merge |
| ⏳ | 🌐 | Squash + merge `feat/governance-platform` to main; tag release |

### Phase 3 — Tamper-evidence + SIEM push (post-GA, named follow-ups)

| | Owner | Task |
|---|---|---|
| 📋 | 🅢 | Cryptographic Merkle-root publication of `event_log` digests |
| 📋 | 🅢 | Customer-rotatable signing keys + verification REST API |
| 📋 | 🅢 | Per-org SIEM push management UI (Splunk HEC / Datadog / Sentinel) |
| 📋 | 🅢 | DLQ + replay infrastructure for failed SIEM pushes |
| 📋 | 🅢 | Tamper-evidence verification UI |

### Critical path to "ship the governance pitch"

The narrowest demo-able slice is now mostly done. Remaining for closed-loop merge:

1. **Step 3b/3c/3d/3e/3f** (Sergey, ~3–5 days): folds + retention TTL + OCSF read API + anomaly reactor rewire
2. **Phase 4 license relocation + UI gating** (cross-lane, ~2–3 days)
3. **Live-data dogfood pass** (Alexis, ~half day post-3a) — proof-quality screenshots replacing iter22 $0/0
4. **Customer-facing docs flip** (Andre, ~half day post-3b/3c)
5. **Volume regression + cross-org concurrency tests** (Sergey, ~half day) — pre-GA gate
6. **End-to-end smoke test in CI** (cross-lane, ~half day)

Total to closed loop: **~5–8 working days** with 3 lanes in parallel.

---

## Personal-Key Journey — Jane at Acme storyboard + persona-aware home

> Per rchaves directive 2026-04-29: the Jane at Acme 8-screen storyboard from `gateway.md` is the **trial-wedge demo loop** — the apache2-floor experience that closes enterprise sales bottom-up. It was missing as an explicit deliverable until this section. Cross-lane sources: lane-A audit (Andre, kanban) + lane-B UI inventory delta (Alexis at `.monitor-logs/lane-b-jane-storyboard-ui-delta.md`) + lane-S backend audit (Sergey, kanban). Atomic tasks are tracked in **§Phase 1B.5** of the Gantt above.

### The 8-screen storyboard (from gateway.md)

A senior engineer (Jane) at a fictional enterprise customer (Acme) joins the company. IT pings her in Slack. By the end of the day she's productive in Claude Code with org-attributed spend, a personal monthly budget set by her admin, no manual provider config, and a personal usage dashboard.

| Screen | Storyboard intent |
|---|---|
| 0 | Slack message from IT bot: "Welcome Jane! Install LangWatch: `curl -sSL get.langwatch.com \| sh`" |
| 1 | Terminal: `langwatch login` opens browser at `app.langwatch.com/cli/<code>` |
| 2 | Browser: focused single-input "Sign in to LangWatch" with email autodetect → routes to org SSO |
| 3 | Company SSO bounce (Okta/SAML — LangWatch is just the kicker) |
| 4 | Browser: "You're signed in!" + close-tab CTA. Terminal: prints `✓ Logged in as jane@acme.com` + inherited providers (anthropic / openai / gemini) + monthly budget (`$500`, used `$0`) + try-it commands |
| 5 | `langwatch claude` opens Claude Code transparently routed through the gateway with Jane's personal VK |
| 6 | `/me` personal dashboard: 3-card KPI top (spend / requests / most-used model) + spending-over-time chart + by-tool stacked bars + recent-activity row list. WorkspaceSwitcher (Personal / Team / Project flip) at top-left |
| 7 | `/me/settings`: profile (managed by IT) + Personal API Keys per-device with Revoke + Notifications panel + Budget read-only ("$500 / month — set by your Acme admin · cannot edit") |
| 8 | Budget-limit reached: `langwatch claude` prints `⚠ Budget limit reached — ask your team admin to raise your limit`. Admin contact + `langwatch request-increase` command |

### Per-screen current-vs-target audit (Alexis)

| Screen | Today | Bucket | Owner |
|---|---|---|---|
| 0 | get.langwatch.com installer queued in Phase 1A; no desktop app | 🔴 Net-new | 🅐 (CLI distro) |
| 1 | `langwatch login --device` shipped + `pages/auth/cli/[code].tsx` exists | 🟢 Wireable | 🅑 (screenshot) |
| 2 | `/signin` shows full provider list — not the focused single-input variant | 🟡 Polish | 🅑 (`/signin-cli`) |
| 3 | Existing `/api/auth` flow handles SAML/OIDC for SSO-configured orgs | 🟢 Wireable | 🅑 (screenshot) |
| 4 | Bounce-back to generic success page; no provider+budget ceremony; CLI does not enumerate inherited providers/budget | 🟡 Polish (web) + 🔴 Net-new (CLI) | 🅑 (web) + 🅐 (CLI print) |
| 5 | typescript-sdk wrapper shipped | ✅ Shipped | — |
| 6 | `/me` exists with `<MyUsageDashboard>` (sparkline + budget meter); missing 3-card top + by-tool stacked bars + recent-activity rows | 🟡 Polish | 🅑 (layout refresh) |
| 7 | `/me/settings` exists (PAT list + budget readonly); missing per-device labels + notifications panel + "managed by your company" chrome | 🟡 Polish + small Net-new | 🅑 |
| 8 | Web-side `BudgetExceededBanner` shipped (iter5); CLI doesn't render formatted budget-limit-reached message | 🟡 Polish (web) + 🔴 Net-new (CLI) | 🅑 (web) + 🅐 (CLI rendering) |

**Summary**: 1 ✅ shipped, 2 🟢 wireable today (screenshot achievable), 4 🟡 polish/redesign, 3 🔴 net-new (mostly lane-A CLI surfaces). The polish slice fits inside Phase 1B; full demo-loop dogfood is achievable post-1.5b-x.

**Backend audit (Sergey)**: backend is essentially fully built for the Jane journey. `personalUsage.service.ts` exposes `summary` / `dailyBuckets` / `breakdownByModel` / `recentActivity` (matches Screen 6 layout exactly). `personalVirtualKey.service.ts` handles per-device + revoke (Screen 7). Budget-exceeded wire shape locked: HTTP 402 + JSON `{type: 'budget_exceeded', message, scope, ...}` at `auth-cli.ts:701` + `user.ts:460` (consumed today by web `BudgetExceededBanner` via `usePersonalContext.ts:38`; CLI rendering is the lane-A polish). Only 1 missing backend signal: `setupState.hasApplicationTraces` (1.5s, Sergey, ~30min). Resolver should run in `getServerSideProps` on `pages/index.tsx` (deterministic, avoids client-side flash) and fail-safe to `/[firstProject]/messages` on any signal-lookup error.

**Iter27 dogfood discovery (Alexis)**: `/me` + `/me/settings` are already production-ready against the storyboard layout. 1.5b-iv (`/me` layout refresh) + 1.5b-v (`/me/settings` polish) drop from "biggest slice" to ~0.3 iters each — minor polish only. Live screenshots below.

### Live-data screenshots (iter27, Alexis 1.5b-i)

These supersede the iter22 shots that were limited by the pre-3a `$0/0` empty-state. Captured against `pnpm dev :5570` post-Sergey 3a (`fd118131c`) + 1.5b-viii persona resolver (`e40ee0045`).

**Screen 6 — `/me` personal dashboard** (Storyboard layout match: STRONG)
3-card top strip (`SPENT THIS MONTH $0.00` / `REQUESTS THIS MONTH 0` / `MOST-USED MODEL —`) + Spending over time chart placeholder + By tool placeholder + Recent activity ("Run `langwatch claude` to get started" empty-state) + WorkspaceSwitcher dropdown header.
![/me personal dashboard](https://i.img402.dev/7zx4ipvw0w.png)

**Screen 7 — `/me/settings`** (Storyboard layout match: STRONG)
Profile section with `Managed by test IT` subtitle on email row + Personal API Keys section ("No personal keys yet") + Notifications panel (3 checkboxes for 80% / weekly summary / per-request threshold) + Budget section ("No personal budget set by your admin"). The "managed by your company" chrome is already in place — the storyboard's helper text rendering matches the design.
![/me/settings personal-key surface](https://i.img402.dev/ojp13bkmso.png)

**Screen 1 — `/cli/auth?user_code=...` browser handshake**
"Authorize the LangWatch CLI" + monospace user code + "Confirm this matches the code in your terminal" + Approve / Deny. The browser side of `langwatch login --device`.
![/cli/auth browser handshake](https://i.img402.dev/qgiw81w31i.png)

**Screen 4 — `/cli/auth` web-side success ceremony (the apache2-floor demo wedge proof)**
"Authorize the LangWatch CLI" header + green-tick "You're signed in!" message + "LangWatch CLI is now authorized for **<org>** using the `default` personal key. You can close this tab and return to your terminal." That's Jane's first "I'm in" moment captured live. Issued personal Virtual Key carries the org-default `RoutingPolicy`.
![/cli/auth web-side success ceremony](https://i.img402.dev/e0emfvpzoy.png)

**Negative-case — approval-failed when org has no provider configured (caught + fixed inline)**
The dogfood pass surfaced a real UX bug: when an admin tries to approve the device-flow before they've configured a ModelProvider, the page returned a generic "Failed to issue key" with no action. **Inline fix shipped in `915d8def3`** updates the message to "Your admin needs to configure a model provider first. Ask them to add one at Settings → Model Providers." This screenshot is the BEFORE state — captured during dogfood, fixed in the same PR.
![/cli/auth approval-failed BEFORE 915d8def3](https://i.img402.dev/7tgpvbkzmb.png)

**iter28 discoveries** (Alexis post-screenshot pass):

1. **Device-flow happy path is end-to-end functional once provider + default RoutingPolicy are configured.** Setup sequence (committable as a follow-up dogfood utility): `ModelProvider` (scope=ORGANIZATION) → default `RoutingPolicy` (scope=organization, isDefault=true, providerCredentialIds=[modelProvider.id], modelAllowlist=[...]) → device-flow approve succeeds. Without the default RoutingPolicy, `PersonalVirtualKeyService.issue` → `VirtualKeyService.create` → `assertProviderCredentialsBelongToProject` fails with "At least one provider credential is required" — this is the failure path captured in the BEFORE screenshot above.

2. **`RoutingPolicy.scope` case-sensitivity bug found**: seed wrote `scope='ORGANIZATION'` (uppercase) but `routingPolicy.service.ts:resolveDefaultForUser` queries `scope='organization'` (lowercase). Subtle data-shape inconsistency. Tracked as a follow-up bug-fix; one-shot migration utility at `langwatch/scripts/dogfood/fix-policy-scope.ts` is committable.

3. **CLI terminal-side captures (Screens 1 / 4 / 5 / 8) require additional setup**:
   - Screens 1 + 4 (CLI prints) need `langwatch login --device` against a fully-configured org (provider + default policy + Bearer token persistence)
   - Screen 5 (`langwatch claude` running) requires Claude Code installed locally + actual gateway-routed LLM call — out of scope for headless Playwright. Will be captured via image-stitching from CLI text output in a code block in the customer-facing docs.
   - Screen 8 (budget-exceeded terminal) requires hitting the actual budget cap (token-counting + cost-rounding + budget-debit timing).

Populated `/me` + `/me/settings` recapture (with personal-VK row + actual usage data) is pending the hot-reload settle on the iter28 dev server. Will update this section when those land.

### Persona-aware home — resolver, not page (Alexis)

rchaves's 4-persona model:

| Persona | Trigger | Default home |
|---|---|---|
| 1 — Personal-only (just CLI users) | Has personal VK + zero project memberships | `/me` |
| 2 — Personal + Project (mixed) | Has personal VK + ≥1 project membership | `/me` (with "Switch to project view" CTA inline; WorkspaceSwitcher fallback) |
| 3 — **Project-only LLMOps (CURRENT default — most existing customers)** | No personal VK + ≥1 project membership | `/[firstProject]/messages` (today's behavior — must NOT change) |
| 4 — Super-admin governance | Org has governance ingest AND user has organizationManage permission AND plan = enterprise | `/governance` |

**Decision: route resolver, not a new `/home` page.** Server-side redirect at `pages/index.tsx` `getServerSideProps` consuming `api.governance.setupState` (already exposed in iter15) + role bindings + plan tier. New `personaResolver.service.ts` (~80 LOC) plus a tRPC procedure that returns the resolved path. Override mechanism: persist user's last-visited home in user settings so explicit navigation sticks across sessions.

**Critical constraint (rchaves)**: most current LangWatch users are LLMOps admins NOT in any AI Gateway flow. Persona-3 (project-only) MUST stay on `/[project]/messages` exactly as today. Locked as a regression test in 1.5b-viii: org with no governance + no personal VKs + with projects → resolver returns `/[firstProject]/messages`. Sergey's `setupState.hasApplicationTraces` flag (1.5s) is the substrate signal for this default-detection.

**Detection logic** (proposed at `langwatch/src/server/governance/personaResolver.service.ts` — Alexis):

```typescript
function resolvePersonaHome({ user, organizationId, setupState, plan }) {
  // Persona 4 — super-admin governance (combo guard prevents
  // accidental /governance default for LLMOps-only admins)
  if (
    setupState.hasGovernanceIngest &&
    user.hasOrganizationManagePermission &&
    plan.isEnterprise
  ) return "/governance";

  // Persona 1 — personal-only
  if (setupState.hasPersonalVirtualKey && user.projectMemberships.length === 0)
    return "/me";

  // Persona 2 — mixed (defaults to /me; WorkspaceSwitcher flips to project)
  if (setupState.hasPersonalVirtualKey && user.projectMemberships.length > 0)
    return "/me";

  // Persona 3 — project-only LLMOps (DEFAULT for current customers)
  return defaultProjectHome(user); // typically /[firstProject]/messages
}
```

### Atomic-task split (also tracked in §Phase 1B.5 of the Gantt)

**Lane-B (Alexis)** — 10 atomic UI tasks, ~6 iters:
1.5b-i screenshots Screens 1/3/5 · 1.5b-ii Screen 2 single-input email variant · 1.5b-iii Screen 4 "You're in!" ceremony · 1.5b-iv Screen 6 /me layout refresh (biggest slice) · 1.5b-v Screen 7 /me/settings polish · 1.5b-vi Screen 8 BudgetExceededBanner enrichment · 1.5b-vii WorkspaceSwitcher v2 · 1.5b-viii Persona resolver service + / redirect + tRPC + regression test (~300 LOC + migration) · 1.5b-ix BDD spec `persona-home-resolver.feature` · 1.5b-x Live-data Playwright dogfood capturing all 8 screens

**Lane-S (Sergey)** — 1 atomic backend task:
1.5s `setupState.hasApplicationTraces` flag for persona-3 default-detection (1-method addition, no schema change)

**Lane-A (Andre)** — 4 atomic tasks (CLI + docs):
1.5a-cli-1 CLI Screen 4 provider+budget enumeration on login completion · 1.5a-cli-2 CLI Screen 8 budget-limit message + `langwatch request-increase` · 1.5a-docs `docs/getting-started/personal-ide-keys.mdx` storyboard walkthrough + Slack onboarding template · 1.5a-marketing open-core marketing-page outline

### Deferred decisions for rchaves (3 votes)

- **Vote G — Phase 1B.5 sequencing**: parallel with Phase 4 (license relocation), or sequential (1B.5 first, then Phase 4)? Lane-B + Lane-S vote **parallel** (zero merge-conflict surface; 1B.5 touches `/me`, `/me/settings`, persona resolver; Phase 4 touches `ee/governance/*` relocation). Need rchaves's call.
- **Vote H — In-this-PR vs follow-up PR**: ship 1B.5 inside `feat/governance-platform`, or as a separate follow-up PR? Lane-B votes **SPLIT**: block this PR on the demo-loop critical path (1.5b-i + ii + iii + iv + v + viii + 1.5s + 1.5a-cli-1 + 1.5a-cli-2); follow-up PR for polish (1.5b-vi + vii + ix + x + 1.5a-docs + 1.5a-marketing). Lane-A leans the same; lane-S agnostic. Need rchaves's call.
- **Vote I — Rollout shape**: feature-flagged gradual rollout (e.g. `release_persona_home_resolver_default_on`) vs default-on launch? Lane-B + Lane-S vote **feature flag** — default-on for orgs created post-merge, default-off for existing orgs with explicit `/me/settings` opt-in. Locks the LLMOps-customer-majority safety. Need rchaves's call.

---

## PM round-up — what's missing for production polish

Cross-lane sources: lane-A (Andre), lane-B (Alexis at `.monitor-logs/lane-b-license-split-input.md` §5+§7), lane-S (Sergey backend gaps).

### Customer-facing flow gaps

1. **No first-time-admin tour.** A CTO landing on `/governance` for the first time gets the layout but no walkthrough. Needs a 3-step guided overlay: "1. Add a source 2. Send a test event 3. Watch it appear in your dashboard."
2. **No "fire test event" button.** SecretModal shows a curl example but no in-product affordance to close the verify loop in 60 seconds.
3. **No source-health degradation alert.** A source that goes silent for 24h stays "Active" until the rolling window flips. Should fire an internal anomaly: "ingestion-source went silent."
4. **Onboarding checklist deep-nested.** First-source-mint is 3 clicks (Settings → Governance → Ingestion Sources → +Add). Collapse to single empty-state CTA on `/governance`.
5. **Workspace switcher v2 (Alexis)**: Personal vs Team visual + chrome context indicator.
6. **CLI↔Web bridge (Alexis)**: session URL print on `langwatch login` + OTel resource stamp + `langwatch dashboard` cmd.
7. **No spend forecasting.** Dashboard shows current 7d/30d spend but nothing predicts "you'll hit your budget cap on day 23 of this month at current burn." High-value low-cost addition once ActivityMonitorService has the data.

### UX polish gaps

8. **Empty-state mid-state (Sergey)**: when source exists but no spans flowing → $0/0 with no diagnostic. Need "Source minted X minutes ago — first event expected within Y" hint.
9. **Source detail page lacks rate-over-time sparkline (Sergey)**. Would help diagnose drops.
10. **WorkspaceSwitcher Layer-1 invariant invisible to support staff (Sergey)**. `?show_internal=1` debug flag for triaging "missing project" reports.
11. **CLI ingest commands gated behind `LANGWATCH_GOVERNANCE_PREVIEW=1` env var** — drop the gate when the feature is real; until then docs should call this out.
12. **OTLP body shape varies subtly per source-type** — per-platform docs need a "Beyond minimum" section per source for vendor-specific attributes.
13. **AnomalyRule composer drawer width is `lg` — cramped for descriptions**. Lane-B follow-up.

### Backend production-quality gaps (Sergey)

14. **Volume regression missing** — receiver rewire passed 13 unit-shape tests but no `1000 spans/sec for 60s`. Hidden-Gov-Project lazy-ensure does `prisma.findFirst` on EVERY request — needs cache.
15. **Cross-org concurrency** — Andre's helper has 5-concurrent test for ONE org. Missing: 50 orgs × 100 concurrent first-mints. The slug-based collision check at `governanceProject.service.ts:82` is the linchpin under that load.
16. **Reactor backpressure** — when 3b/3e land, anomaly reactor + governance_kpis fold + trace-summary fold all share the trace-processing pipeline. Need load test to verify priority ordering.
17. **CH retention TTL atomicity** — when 3c lands, retention is attribute-keyed. If a span lands without the attribute (bug), it defaults to 30d → wrong tier for `seven_years` sources. Need TTL-mismatch alarm.
18. **Receiver auth rate limiting** — `/api/ingest/{otel,webhook}/:sourceId` is unbounded. Leaked source secret = firehose. Need per-source Redis-token-bucket RPS limit.
19. **OCSF schema versioning** — when 3d lands, v1.1 cooked into the fold. v1.2 is in draft. Need `OcsfSchemaVersion` column for graceful upgrade.

### Dogfood gaps

20. **Live-data dashboard screenshot for the PR doc** — iter22 shows $0/0 (pre-3a stub). Post-3a, Alexis re-runs the dogfood script and replaces shot #1 with a real-numbers version.
21. **End-to-end smoke test in CI** — no CI job currently does the full mint-org → mint-source → POST OTLP → assert-dashboard-shows-it loop.
22. **Cross-org isolation smoke at HTTP receiver** — tested in store + helper layers but not at the HTTP receiver layer with full request from org-A and verification org-B doesn't see anything.
23. **No load test / performance assertion** — pre-GA blocker for enterprise sales calls.
24. **Live `langwatch claude` dogfood GIF for the README/marketing** (Alexis §7).
25. **No demo-data seed for fresh installs (Alexis §7)** — first-run-experience without dogfood is a $0/0 dashboard.

### Testing gaps

26. **No spec-driven tests yet** — 8 BDD specs describe scenarios; each scenario is implicitly proven by an integration test in another file. Could harden into explicit BDD test runs (probably defer to post-GA).
27. **No license-split assertion test** — once relocation lands, defensive test in `ee/governance/__tests__/` that asserts non-enterprise org cannot reach `/api/ingest/*` regardless of valid Bearer.
28. **No tamper-evidence spec test skeleton** — follow-up contract is named in `compliance-baseline.feature` but no skip-but-named scenarios. Pre-shipping the design.
29. **Anomaly reactor needs idempotency test** — schema-level constraint exists; reactor itself untested under retry.
30. **No real-world wire-shape fixtures (Sergey)** for non-OTel sources (workato/s3_custom/copilot_studio webhook bodies).

### Documentation gaps

31. **No `dev/docs/architecture/` rollup** of the unified-substrate decision. ADR-018 captures it but no engineering-onboarding-friendly diagram + flow doc.
32. **No customer-facing migration story** for existing self-hosters from BSL → Apache 2.0 + ee/. What happens to their governance data on upgrade? Do they need a new license key?
33. **No `LICENSE-EE` reviewable text** — blocker for licensing pivot.
34. **No marketing-page outline for the open-core split** — public-facing pricing page.
35. **`ee/` license-header CI check (Alexis §7)** — defensive regression against accidental file moves.

### Deferred decisions for rchaves resolution

- **Vote D** (license): Personal-key SSO (SCIM auto-provisioning of personal teams + policies) — apache2 vs `ee/`? Lane-A and lane-B lean apache2 (basic SAML in CE per GitLab precedent); SCIM/group-sync in EE. Need rchaves's call.
- **Vote F** (license-flip timing): BSL → Apache 2.0 license-flip — same PR as governance ee/ relocation, or separate prep PR landing first? Need rchaves's call.
- **Vote G** (Phase 1B.5 sequencing — see § Personal-Key Journey): parallel with Phase 4 (license relocation), or sequential (1B.5 first, then Phase 4)? Lane-B + Lane-S vote **parallel** (zero merge-conflict surface). Need rchaves's call.
- **Vote H** (in-this-PR vs follow-up): ship Phase 1B.5 inside `feat/governance-platform`, or as a separate follow-up PR? Lane-B votes **SPLIT**: block this PR on the demo-loop critical path (1.5b-i+ii+iii+iv+v+viii + 1.5s + 1.5a-cli-1+2); follow-up PR for polish (1.5b-vi+vii+ix+x + 1.5a-docs + 1.5a-marketing). Lane-A leans the same; lane-S agnostic. Need rchaves's call.
- **Vote I** (rollout shape): feature-flagged gradual rollout (e.g. `release_persona_home_resolver_default_on`) vs default-on launch for the persona-aware `/` redirect? Lane-B + Lane-S vote **feature flag** — default-on for orgs created post-merge, default-off for existing orgs with explicit `/me/settings` opt-in. Locks the LLMOps-customer-majority safety. Need rchaves's call.

### Top 5 PM-hat recommendations (consolidated)

1. **Land step 3b/3c (folds + retention TTL) before doing the ee/ relocation.** Folds are new code; relocating new code immediately is fine. Retention TTL is the compliance pricing axis; lock it before moving.
2. **Do the ee/ relocation as 3 commits, one per lane** (4a-1 backend; 4a-2 backend; 4a-3 UI), so each lane reviews their slice independently. No big-bang refactor.
3. **Block the merge on the live-data dogfood pass** (Alexis post-3a) and the end-to-end smoke test in CI (cross-lane). Without these the PR is shippable in form but not in confidence.
4. **Defer tamper-evidence + revocation-automation completely** to a follow-up PR. Naming them as filed-not-shipped (already done in spec) is enough.
5. **Add license-gate assertion test (4c-1)** as a hard gate before merge — defensive correctness against future license-bypass regressions.

---

- **Cryptographic tamper-evidence** (Merkle root publication + signing keys
  + verification REST API): filed-not-shipped. Hardening layer for the
  regulated-industry segment (SEC 17a-4 / HITECH strict / EU AI Act high-risk).
  Append-only `event_log` covers SOC 2 Type II / ISO 27001 / EU AI Act baseline /
  GDPR / HIPAA-most-uses without it.
- **Heavyweight SIEM PUSH infrastructure** (DLQ + per-org webhook UI + replay):
  filed-not-shipped. The OCSF read projection + lightweight cursor-pull cron
  pattern covers the common case.
- **Per-platform deeper webhook adapters** (workato job-array unwrapping,
  S3 DSL parsing, Copilot Studio Purview event shapes, OpenAI/Claude
  compliance JSONL pullers): the default
  `buildWebhookLogRequest` ships as the body=raw-JSON one-event-per-envelope
  fallback. Per-platform adapters land per-source as follow-up PRs that
  REPLACE the default mapper but keep the same handoff.
- **Org plan ceiling enforcement on retention class**: composer offers all
  three options; plan-side validation lands when billing config exposes the
  per-org retention ceiling.

---

## Notes for reviewers

- The architecture pivoted mid-branch (rchaves directive + master_orchestrator
  ratification 2026-04-27). The mechanical delete commit `f3de1ae07` is the
  boundary; pre-pivot commits are preserved for audit but the architecture
  they reflect is no longer the target.
- Three lanes (backend / docs / UI) coordinate via the `kanban` channel;
  cross-lane decisions are surfaced in the same channel before code lands.
- The full discussion that produced the architecture lock (5 rounds of
  pushback / refinement / consolidation) is in the kanban channel history.
  This document captures the LOCKED architecture; the discussion is not
  re-litigated here.

---

*Last updated: lane-S architecture skeleton seed. Pending: Andre's narrative
fold + Alexis's screenshots + the read-side cutover (step 3/3) commits.*
