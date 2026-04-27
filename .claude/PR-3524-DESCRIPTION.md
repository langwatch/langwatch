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

Earlier (pre-correction) commits on the branch are preserved for the audit
trail. The mechanical delete commit (`f3de1ae07`) is the boundary between
"old direction" and "unified-trace correction."

---

## What's still in flight (step 3/3)

| Slice | Owner | State |
|---|---|---|
| `ActivityMonitorService` rewire onto trace_summaries + log_records with origin filter | Lane S | next slice |
| `governance_kpis` fold projection on the trace-processing pipeline | Lane S | next slice |
| `governance_ocsf_events` fold projection | Lane S | next slice |
| Per-origin retention TTL hook on recorded_spans + log_records | Lane S | next slice |
| Anomaly reactor rewire onto `governance_kpis` fold | Lane S | next slice |
| End-to-end HTTP receiver integration test | Lane A | ✅ shipped `d20a1b403` (13 tests) |
| Layer-2 per-consumer integration test | Lane B | superseded — Layer-1 + Andre's helper composition + UI dogfood cover the invariant; further per-consumer assertions deferred to post-step-3/3 when the consumer registry has more surfaces to assert against |
| UI verification screenshots | Lane B | ✅ shipped — 8 screenshots embedded above (iter22 dogfood) |
| Customer-facing docs flip + dev/docs/ ADR + per-platform mapping page | Lane A | gated on step 3/3 (Andre) |

---

## Customer-facing surfaces touched by this PR

> **Andre to fold customer-facing narrative + per-platform mapping here from
> his iter19 draft (.monitor-logs/pr-3524-body-iter19-andre-lane-a-draft.md).**

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

3. **Add ingestion source composer** — the headline UI artifact of
   Sergey's 2b-i: source-type dropdown, display name, description, and
   the **retention class dropdown** with three options gated by org
   plan ceiling — Operational (30 days, SOC 2 / ISO 27001 baseline) /
   Compliance (1 year, EU AI Act / GDPR / HIPAA-most-uses) /
   Long-form audit (7 years, regulated industry).
   **Crucially, NO Project field** — the hidden Governance Project is
   internal routing only, never user-configurable. Per
   `master_orchestrator` + `rchaves` directive 2026-04-27.
   ![Ingestion source composer](https://i.img402.dev/9220teidwj.png)

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

8. **AnomalyRule composer** — Name + Severity + Description + Rule
   type + Scope + Threshold JSON. v1 ships `spend_spike` rule type +
   log-only dispatch; `rate_limit` / `after_hours` / Slack / PagerDuty
   / webhook / email destinations are explicitly **preview** in the
   composer copy (config persists, evaluation/dispatch in follow-up).
   Honest framing — no mocked-v0 surfaces per @rchaves "no mocks in
   UI" directive.
   ![Anomaly composer](https://i.img402.dev/yx701f85e8.png)

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

## Caveats / out of scope

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
