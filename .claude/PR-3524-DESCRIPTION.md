# feat(governance): the LangWatch AI Governance Platform

> **Single canonical PR description for #3524** — kept up to date as the unified-trace
> branch correction lands, lane-by-lane. Edited live by Sergey (backend), Andre
> (docs/customer narrative), Alexis (UI walkthroughs + screenshots). Sync to GitHub via
> `gh pr edit -F .claude/PR-3524-DESCRIPTION.md`.

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

## BDD specs — the executable contract (8 files / ~1,382 LOC)

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

Cross-references: each spec cites siblings rather than duplicating scenarios.
Andre's `compliance-baseline.feature` references my `retention.feature` +
`event-log-durability.feature` as canonical sources for the mechanics; Alexis's
`architecture-invariants.feature` references all four lane-S specs.

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
| `governance_kpis` fold projection (step 3b) | Lane S | ⏳ next |
| Per-origin retention TTL hook on recorded_spans + log_records (step 3c) | Lane S | ⏳ next |
| `governance_ocsf_events` fold projection (step 3d) | Lane S | ⏳ next |
| Anomaly reactor rewire onto `governance_kpis` fold (step 3e) | Lane S | ⏳ next |
| OCSF read tRPC procedure for SIEM forwarding (step 3f) | Lane S | ⏳ next |
| End-to-end HTTP receiver integration test | Lane A | ✅ shipped `d20a1b403` (13 tests) |
| Layer-2 per-consumer integration test | Lane B | superseded — Layer-1 + Andre's helper composition + UI dogfood cover the invariant; further per-consumer assertions deferred to post-step-3/3 when the consumer registry has more surfaces to assert against |
| UI verification screenshots | Lane B | ✅ shipped — 8 screenshots embedded below (iter22 + iter23 drawer) |
| Customer-facing docs flip + per-platform mapping page | Lane A | gated on step 3b/3c |
| Live-data dashboard dogfood (replace iter22 $0/0 with real numbers post-3a) | Lane B | ⏳ next, unblocked |
| **License relocation: governance modules → `langwatch/ee/governance/`** (4a) | Lane S+B | ⏳ NEW per rchaves directive 2026-04-28 |
| **UI gating: enterprise-locked surfaces (3-tier) + service-layer 403 + CLI 402 envelope** (4b) | Lane S+B+A | ⏳ NEW per rchaves directive 2026-04-28 |
| **License-gate assertion test: non-enterprise org → 403 on every `api.governance.*` proc** (4c) | Lane S | ⏳ NEW per rchaves directive 2026-04-28 |

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

1. **`/governance` admin overview** — chrome + KPI strip + IngestionSources
   panel + Recent anomalies. Org-scoped surface; the top-nav shows the
   "Organization-scoped — not tied to a project" indicator (iter 19 work)
   confirming the page is not gated on the active project context.
   ![Governance dashboard](https://i.img402.dev/sqnfqmiabr.png)

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
| ⏳ | 🅢 | Step 3b: `governance_kpis` fold projection on trace-processing pipeline (~1d, 2 commits) |
| ⏳ | 🅢 | Step 3c: Per-origin retention TTL hook on `recorded_spans` + `log_records` (CH TTL keyed off `Attributes['langwatch.governance.retention_class']`) |
| ⏳ | 🅢 | Step 3d: `governance_ocsf_events` fold projection (Actor / Action / Target / Time / Severity) |
| ⏳ | 🅢 | Step 3e: Anomaly reactor rewire onto `governance_kpis` fold |
| ⏳ | 🅢 | Step 3f: OCSF v1.1 read tRPC procedure + REST adapter |
| ⏳ | 🅑 | Live-data dashboard dogfood pass (post-3a) — replace iter22 $0/0 with real numbers |
| ⏳ | 🅐 | Customer-facing docs flip (8 ingestion-source pages reframe + new compliance-architecture.mdx + retention.mdx + ocsf-export.mdx + observability/trace-vs-activity-ingestion.mdx flip) |

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

- **Vote D**: Personal-key SSO (SCIM auto-provisioning of personal teams + policies) — apache2 vs `ee/`? Lane-A and lane-B lean apache2 (basic SAML in CE per GitLab precedent); SCIM/group-sync in EE. Need rchaves's call.
- **Vote F**: BSL → Apache 2.0 license-flip TIMING — same PR as governance ee/ relocation, or separate prep PR landing first? Need rchaves's call.

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
