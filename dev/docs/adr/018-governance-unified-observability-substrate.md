# ADR-018: Governance ingestion uses the unified observability substrate

**Date:** 2026-04-27

**Status:** Accepted

## Context

The AI Gateway governance offering needs to ingest several event sources:

1. **OTel-shaped agent activity** — `otel_generic`, `claude_cowork` (Anthropic Cowork emits OTLP spans natively)
2. **Webhook-shaped audit events** — `workato` (per-action webhooks); `s3_custom` callback mode
3. **S3-replay batch feeds** — `s3_custom`, `openai_compliance`, `claude_compliance`, `copilot_studio` (vendor-managed S3 buckets we read on cron)
4. **Pull-mode connectors** — same vendors as above when push isn't available

The first 30 iterations of `feat/governance-platform` built a parallel pipeline alongside our existing OTel ingest:

- New ClickHouse table `gateway_activity_events`
- New write path: receiver → `RecordActivityEventCommand` → `ActivityEventReceived` event in `event_log` → `activityEventStorage` map projection writing to `gateway_activity_events`
- New read path: `ActivityMonitorService` + tRPC procedures querying `gateway_activity_events`
- New reactor: `anomalyDetection.reactor.ts` evaluating ClickHouse conditional aggregations against `gateway_activity_events`
- Two parallel public URL surfaces: `/api/otel/v1/traces` (existing project-scoped) and `/api/ingest/otel/:sourceId` (new org-scoped)

This shipped through ~30 iterations and worked end-to-end, but accumulated three structural problems:

1. **Duplicate ingestion infrastructure.** Two OTLP parsers, two normalisation paths, two write paths to ClickHouse. Bug fixes had to be made twice. Wire-shape regressions could land in one path but not the other.
2. **Two trace stores.** A trace from a customer's `otel_generic` IngestionSource lived in `gateway_activity_events`. A trace from the same customer's existing LangWatch SDK integration lived in `recorded_spans`. Customers had to query two places, alert on two places, build dashboards against two places. Engineers debugging a customer issue had to know which "kind" of trace to look at.
3. **Compliance/RBAC duplication.** The new pipeline needed its own retention policy, its own multitenancy enforcement, its own indexes, its own backup/restore logic — all parallel to the existing trace pipeline that already had those things hardened.

User directive (rchaves, 2026-04-27 in `#langwatch-ai-gateway`):

> we already have a /v1 otel traces endpoint right, which we have hardened over the years and use for everything... I really hope everything should follow our currently existing trace ingestion of course and that you folks didn't just duplicate all that... if anything even the s3 consumed audit logs etc should/could become an otel trace, this way we have a unified view and unified system for creating custom dashboard, metrics, alerts, for anyone to open the trace and debug etc etc... do not save up any effort for later, refactor and pull it out everything you folks did on the wrong direction.

## Decision

**Governance ingestion is origin metadata on the existing unified observability substrate.**

Concretely:

1. **One trace store.** All governance-ingested events land in the same `recorded_spans` (span-shaped) or `log_records` (flat audit-event shape) tables that power the rest of LangWatch.

2. **Two URL surfaces, one internal pipeline.** The public URL split (`/api/otel/v1/traces` for project-keyed SDK ingest; `/api/ingest/otel/:sourceId` and `/api/ingest/webhook/:sourceId` for governance Bearer-keyed ingest) is **only** an auth + routing convenience for customers. Internally both paths hit the same hardened OTLP parser and the same trace pipeline.

3. **Origin metadata.** Every governance-ingested span/log is stamped at the receiver edge with reserved attribute namespaces:
   - `langwatch.origin.kind = "ingestion_source"` — discriminator
   - `langwatch.ingestion_source.{id, organization_id, source_type}` — source identity
   - `langwatch.governance.retention_class` — derived governance context
   - Both namespaces are rejected if found in user-supplied OTLP — no attribute spoofing.

4. **Hidden Governance Project.** Per-org Project of `kind = "internal_governance"`, lazy-ensured on first IngestionSource mint via single `ensureHiddenGovernanceProject(prisma, orgId)` helper at `langwatch/src/server/governance/governanceProject.service.ts:54-110`. Internal routing/tenancy artifact only — never user-visible. Layer-1 filter at `PrismaOrganizationRepository.getAllForUser` (`kind: { not: "internal_governance" }`) covers all org/team/project list consumers; Layer-2 per-consumer assertions ship post-cutover.

5. **Folds for derived views.** `governance_kpis` (KPI strip + anomaly reactor input) and `governance_ocsf_events` (SIEM read API) are reactor-driven derived projections from the unified store. Rebuildable from `event_log`. (Step 3/3 — in flight at time of writing this ADR.)

6. **Per-origin retention.** `IngestionSource.retentionClass` (`thirty_days` / `one_year` / `seven_years`) drives the ClickHouse TTL policy. Set system-side per source, never user-supplied per event. (Step 2c — in flight; column exists today, TTL enforcement lands with step 3.)

### Per-source-type wire-shape decisions

| Source type | Delivery | OTLP shape | Reasoning |
|---|---|---|---|
| `otel_generic` | Push (HTTP) | Spans | Native OTLP exporter; pass-through |
| `claude_cowork` | Push (HTTP) | Spans | Cowork emits OTLP spans natively (Anthropic instrumentation) |
| `workato` | Webhook (HTTP) | Logs | Workato fires one webhook per recipe event; flat shape, no parent-child |
| `s3_custom` | S3 replay (worker) + optional callback webhook | Logs | One S3 line = one event; no span tree |
| `copilot_studio` | Pull (worker) | Logs | Vendor JSON audit feed; flat shape |
| `openai_compliance` | Pull (worker) | Logs | OpenAI compliance API returns audit events; flat shape |
| `claude_compliance` | Pull (worker) | Logs | Anthropic compliance API; flat shape |

### Lifecycle of the hidden Governance Project

```
Org created
  └─ no Governance Project exists yet
Admin enables governance feature flag
  └─ no Governance Project (just a flag, no data yet)
Admin visits /governance
  └─ no Governance Project (just a UI surface, no data yet)
Admin opens IngestionSource composer
  └─ no Governance Project (just a form, no data yet)
Admin clicks Create on first IngestionSource
  └─ ensureHiddenGovernanceProject(prisma, orgId) called
       └─ Project of kind = "internal_governance" created
       └─ IngestionSource record links to this projectId for tenancy
       └─ Helper is idempotent: subsequent IngestionSources reuse the same Project
```

Any future routing callsite (anomaly reactor, OCSF reader, future ingestion entry points) calls the same helper. There is no other lazy-create path.

## Rationale / Trade-offs

### Why this decision

**Customer experience.** Enterprise governance buyers expect their AI activity data to live in *the* observability platform, not a parallel surface. With this design, a customer using LangWatch governance gets the same trace viewer, dashboards, alerting, and retention controls they get for everything else; engineering teams debugging a customer issue only have one place to look.

**Compliance simplification.** Compliance auditors get a single answer to "where does the audit data live": "in our standard trace store, tagged with `langwatch.origin.kind = ingestion_source`." Per-origin retention, RBAC via project membership, and tenancy isolation all reuse mechanisms that are already audited as part of the LangWatch core.

**Engineering cost.** The parallel pipeline meant maintaining two OTLP parsers, two normalisation paths, two ClickHouse schema sets, two TTL policies, two backup procedures, two observability dashboards. Every new feature (a new attribute, a new query path, a new reactor) had to ship twice. The unified-substrate decision collapses that to one.

### Alternatives considered

**A. Keep the parallel pipeline + invest in unification later.** Rejected: the user directive ("do not save up any effort for later, refactor and pull it out") is the authoritative trade-off. The parallel pipeline accumulates engineering cost (and customer-visible inconsistency) the longer it lives. Postponing the unification meant compounding the duplicate-fix burden.

**B. Unify only the storage layer (parallel ingest paths, shared CH tables).** Rejected: would still leave duplicate normalisation, multitenancy enforcement, retention policy, and write-path code. The whole point is one set of hardened controls all the way through; pulling unification only at the table edge captures none of the maintenance benefit.

**C. `Project.kind` as a boolean (`isGovernance`).** Rejected in favour of a free-form string column matching the `IngestionSource.sourceType` pattern. A free-form string lets future routing kinds (e.g. a future `evaluation_runs` or `playground` kind) ship without migrations. Composite index `(teamId, kind)` keeps the filter cheap.

**D. Eager-create Governance Project on org creation or feature-flag flip.** Rejected: master architecture lock pinned **lazy-ensure on first IngestionSource mint**. Keeps the routing artifact creation tied to actual data, makes it auditable (one creation event in `event_log` per org, on the day they actually start using governance), and avoids polluting orgs that turned the feature flag on but didn't follow through.

## Consequences

### Positive

- Single store to query, alert on, build dashboards against, debug from. Customer mental model + engineering mental model align.
- Single set of compliance / RBAC / multitenancy enforcement (already hardened over years of LangWatch SDK ingest).
- Single OTLP parser. `langwatch/src/server/otel/parseOtlpBody.ts` (extracted in commit `d62fa1c41`) is consumed by both `/api/otel/v1/traces` and `/api/ingest/otel/:sourceId`. Locked at the contract level by `langwatch/src/server/otel/parseOtlpBody.test.ts` (commit `38106f768`, 18 unit tests).
- Webhook + S3 receivers normalise to OTLP envelopes before handoff — keeps the downstream pipeline OTLP-only.
- Future ingestion sources are "another origin tag", not "another pipeline".
- Compliance auditors get one answer: "all governance data lives in our standard trace store, tagged with `langwatch.origin.*`."

### Negative

- Required ripping out ~30 iterations of the parallel pipeline (mechanical delete in `f3de1ae07`, ~1,770 LOC removed).
- Webhook-shaped sources (one row per HTTP delivery, no span tree) need a logs-OTLP adapter — not a span-OTLP adapter.
- ClickHouse TTL has to read attribute values to decide retention class; we accept the per-attribute predicate cost.
- Multitenancy enforcement: governance ingest is org-scoped, but the trace store is project-scoped. Resolved via the hidden Governance Project pattern (lazy-ensure, internal routing only) — adds an indirection but reuses an otherwise-hardened model.

### Neutral / accepted complexity

- Two OTLP wire shapes per source type (spans for span-shaped, logs for flat feeds). The public docs explain which sources land which shape so customers can verify their setup.
- Reserved attribute namespaces (`langwatch.origin.*`, `langwatch.governance.*`) are now part of the OTel attribute schema we maintain. The receiver rejects them from user input.

### Tamper-evidence is named, not abandoned

Cryptographic verification (Merkle-root publication of `event_log` digests + customer-rotatable signing keys + verification REST API) is needed for:

- EU AI Act high-risk tier
- HIPAA covered-entity strict (HITECH cryptographic verification)
- SEC 17a-4 (broker-dealer WORM) — likely also needs WORM storage substrate beyond LangWatch's current model

The follow-up contract is locked in `specs/ai-gateway/governance/compliance-baseline.feature` so the design isn't reinvented when a named customer requirement lands. Out of scope for the unified-substrate decision documented here.

## Branch-correction artifacts

For posterity / reviewer cross-check, the parallel-pipeline removal is fully traceable on `feat/governance-platform`:

| Commit | What |
|---|---|
| `f3de1ae07` | Mechanical delete of the parallel pipeline (`gateway_activity_events` table, ActivityMonitor service, anomalyDetection reactor against the parallel pipeline). ~1,770 LOC removed. |
| `d62fa1c41` | Shared OTLP body parser extracted; both public and governance receivers consume it. |
| `bdb137e6b` | Schema additions for the new direction (`Project.kind`, `IngestionSource.retentionClass`). |
| `94426716e` | Layer-1 filter at `PrismaOrganizationRepository.getAllForUser` (`kind: { not: "internal_governance" }`) + live-data integration regression. |
| `e2c30961a` | `ensureHiddenGovernanceProject` helper + `retentionClass` wire-in (composer dropdown + `IngestionSourceService.createSource` calls helper first). |
| `0d07ac371` | Receiver rewire (OTel) — `/api/ingest/otel/:sourceId` calls helper + stamps origin metadata + hands off to existing trace pipeline. |
| `33a8cf6d0` | Receiver rewire (webhook) — `/api/ingest/webhook/:sourceId` maps envelope → OTLP `log_record` + same handoff to existing log pipeline. |

Test coverage proving the contract (run with `pnpm test:integration` against ClickHouse + Postgres testcontainers):

| Commit | Tests | Coverage |
|---|---|---|
| `38106f768` | 18 unit | Parser-equivalence — same shared helper across both URL surfaces; identity/gzip/deflate/brotli decode equivalence; JSON↔protobuf wire-format equivalence |
| `f25d713ab` | 6 integration | event_log non-repudiation foundation — append/readback fidelity; deletion of `stored_spans` view leaves `event_log` evidence intact; cross-trace + cross-tenant isolation; ReplacingMergeTree idempotency |
| `0a2b7e8d9` | 8 integration | `ensureHiddenGovernanceProject` lazy-ensure invariants — first-mint creates exactly one Project; idempotent under sequential + 5-concurrent races; throws on org-without-team; cross-org tenancy; composes with Layer-1 filter |
| `d20a1b403` | 13 integration | End-to-end HTTP receiver — auth contract; source-type routing; happy path stamps all 5 origin attrs; caller attrs preserved; handleOtlp{Trace,Log}Request invoked with govProject.id as tenant |

## References

- Related specs: `specs/ai-gateway/governance/{architecture-invariants, ui-contract, receiver-shapes, retention, folds, event-log-durability, compliance-baseline, siem-export}.feature`
- Related ADRs: ADR-015 (projection-replay-coordination); ADR-017 (gateway-trace-payload-capture)
- PR: https://github.com/langwatch/langwatch/pull/3524 (`feat/governance-platform`)
- Code:
  - Receiver: `langwatch/src/server/routes/ingest/ingestionRoutes.ts`
  - Hidden Gov Project helper: `langwatch/src/server/governance/governanceProject.service.ts:54-110`
  - Layer-1 filter: `langwatch/src/server/app-layer/organizations/repositories/organization.prisma.repository.ts`
  - Shared OTLP parser: `langwatch/src/server/otel/parseOtlpBody.ts:57-159`
