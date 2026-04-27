Feature: AI Gateway Governance — Architecture Invariants
  Cross-cutting architectural invariants locked by rchaves +
  master_orchestrator on 2026-04-27 after a multi-lane pushback
  round. Captures WHAT is source of truth, WHAT is derived, what
  the public/internal boundaries are, and what is explicitly NOT
  in scope (filed as follow-up).

  This file is the high-level contract. The implementation-adjacent
  specs (Sergey's receiver-shapes / folds / retention /
  event-log-durability; Andre's compliance-baseline / siem-export;
  Lane-B's ui-contract) refine the details. If any of those drift
  from this file's invariants, this file wins — open a discussion
  before changing.

  Locked-shape decisions:
    1. ONE unified observability substrate. recorded_spans +
       log_records (the existing trace pipeline) are the source
       of truth. There is NO parallel governance_event store.
       gateway_activity_events table + activity-monitor-processing
       pipeline have been deleted as part of this PR's branch
       correction.
    2. OTLP shape per source. Span-shaped inputs (agent traces,
       Cowork tool_use, span-emitting OTel exporters) emit OTLP
       traces; flat audit feeds (Workato webhook envelopes, S3
       compliance JSONL, Copilot Studio Purview events, the
       compliance pullers) emit OTLP logs. Both feed the same
       unified store; choice is per source type.
    3. Hidden internal Governance Project per organization, as
       routing/tenancy artifact only. Never user-visible. Never
       a composer-visible field. Carries the org's per-origin
       retention class + RBAC for governance data.
    4. Origin metadata convention: `langwatch.origin.*` for
       source identity (kind, ingestion_source_id,
       organization_id), `langwatch.governance.*` for
       system-derived attributes (retention_class,
       anomaly_alert_id, etc.). Reserved namespaces; not
       user-settable.
    5. Governance fold projections derive KPIs + OCSF read shape
       from the unified store. governance_kpis fold powers the
       /governance dashboard + anomaly reactor.
       governance_ocsf_events fold/view powers SIEM forwarding.
    6. Public ingest URLs may stay separate (different auth /
       tenancy / UX) but internally they all hand to the unified
       trace/log pipeline. /api/otel/v1/traces (project key auth)
       and /api/ingest/otel/:sourceId (source bearer auth) share
       the parser/decompress internals.
    7. Append-only event_log (already shipped in PR #3351) is the
       durability invariant. Every receiver write goes through
       event_log → projections rebuild from it.
    8. Cryptographic tamper-evidence is DEFERRED. Append-only
       event_log + per-origin retention + RBAC is the SOC2 Type
       II / ISO 27001 / EU AI Act / GDPR / HIPAA-most-uses
       baseline. Cryptographic Merkle-root publication is a
       follow-up hardening layer for regulated-industry
       contracts.

  Pairs with:
    - specs/ai-gateway/governance/ui-contract.feature              (Alexis)
    - specs/ai-gateway/governance/compliance-baseline.feature      (Andre)
    - specs/ai-gateway/governance/siem-export.feature              (Andre)
    - specs/ai-gateway/governance/receiver-shapes.feature          (Sergey)
    - specs/ai-gateway/governance/folds.feature                    (Sergey)
    - specs/ai-gateway/governance/retention.feature                (Sergey)
    - specs/ai-gateway/governance/event-log-durability.feature     (Sergey)

  # ---------------------------------------------------------------------------
  # Single source of truth — unified observability substrate
  # ---------------------------------------------------------------------------

  @bdd @architecture @substrate @critical
  Scenario: All ingestion-source data lands in the unified observability substrate
    Given any IngestionSource of any source type
    When a customer pushes a payload to its receiver
    Then the receiver normalizes the payload to the appropriate OTLP
      shape (traces or logs based on source type)
    And the receiver hands the canonical OTLP envelope to the existing
      trace/log ingestion pipeline (the same pipeline /api/otel/v1/traces
      uses)
    And the data lands in recorded_spans (for span-shape) or log_records
      (for log-shape) — the same ClickHouse tables that hold agent
      traces from /api/otel/v1/traces
    And NO parallel governance-only ClickHouse table is written
    And NO bespoke "audit event" storage path exists

  @bdd @architecture @substrate @critical
  Scenario: gateway_activity_events table no longer exists
    When the database schema is enumerated
    Then there is NO ClickHouse table named "gateway_activity_events"
    And there is NO Prisma migration creating one
    And the activity-monitor-processing pipeline directory under
      langwatch/src/server/event-sourcing/pipelines/ no longer exists
    And no code path writes to a parallel governance event store

  # ---------------------------------------------------------------------------
  # OTLP shape per source type — spans vs logs
  # ---------------------------------------------------------------------------

  @bdd @architecture @otlp-shape
  Scenario: Span-shape source types emit OTLP traces
    Given an IngestionSource of type "otel_generic" or "claude_cowork"
    When a customer pushes an OTLP body to the receiver
    Then the receiver parses it as OTLP traces (resource_spans →
      scope_spans → spans with start/end time, parent_id, etc.)
    And the spans land in recorded_spans
    And they are visible in the existing LangWatch trace viewer
      (filtered by langwatch.origin.ingestion_source_id)

  @bdd @architecture @otlp-shape
  Scenario: Flat-event source types emit OTLP logs
    Given an IngestionSource of type "workato", "s3_custom",
      "copilot_studio", "openai_compliance", or "claude_compliance"
    When the receiver normalizes the platform-specific input shape
      (webhook envelope, JSONL line, etc.)
    Then it emits OTLP log records (resource_logs → scope_logs →
      log_records with time, severity, body, attributes) — NOT
      synthetic 0-duration spans
    And the log records land in log_records
    And they are visible in the existing log-detail pane
      (filtered by langwatch.origin.ingestion_source_id)

  # ---------------------------------------------------------------------------
  # Hidden internal Governance Project — routing only, never user-visible
  # ---------------------------------------------------------------------------

  @bdd @architecture @hidden-project @critical
  Scenario: A hidden Governance Project is auto-created per org on first IngestionSource mint
    Given the organization has no IngestionSources
    When the first IngestionSource is minted
    Then exactly one Project row with kind = "internal_governance"
      is auto-created within the org
    And subsequent IngestionSource mints in the same org route to
      the SAME hidden Governance Project (one per org, not per source)
    And the hidden project has no human-friendly name displayed
      anywhere in the UI / API / docs

  @bdd @architecture @hidden-project @critical
  Scenario: The hidden Governance Project is internal routing only
    Given the hidden Governance Project exists
    Then its purpose is exactly: holding tenancy + retention + RBAC
      context for IngestionSource data
    And it is NEVER presented as a user-facing project (see
      ui-contract.feature for UI-side enforcement scenarios)
    And it does NOT appear in user-visible API responses
      (GET /api/v1/projects, GET /api/v1/organizations/:id/projects,
       etc.)
    And it does NOT appear in billing exports as a separate
      line-item (its usage rolls up to org-level total)

  @bdd @architecture @hidden-project @critical
  Scenario: Governance data tenancy is the hidden project, not a parallel axis
    Given a span or log record carrying
      langwatch.origin.kind = "ingestion_source"
    When it lands in recorded_spans / log_records
    Then its Project tenancy is the hidden Governance Project of
      that source's organization
    And the existing project-scoped CH partitioning + RBAC +
      retention machinery applies to it unchanged
    And NO new "org-tenancy" axis is introduced at the trace store
      level (no parallel partition key, no nullable Project on
      Trace/Span)

  # ---------------------------------------------------------------------------
  # Origin metadata + reserved namespaces
  # ---------------------------------------------------------------------------

  @bdd @architecture @namespaces @critical
  Scenario: Receiver stamps langwatch.origin.* attributes on every governance payload
    Given any IngestionSource receiver accepts a payload
    When the receiver hands the canonical OTLP envelope to the
      trace/log pipeline
    Then every span / log record in the envelope has these resource
      attributes set (overwriting any user-supplied values):
      | attribute key                               | value                   |
      | langwatch.origin.kind                       | "ingestion_source"      |
      | langwatch.origin.ingestion_source_id        | lw_is_<source-id>       |
      | langwatch.origin.organization_id            | <org-id>                |
    And the span/log carries any source-config-driven attributes too
      (e.g. langwatch.governance.retention_class from the source's
       retention setting)

  @bdd @architecture @namespaces @critical
  Scenario: User-supplied langwatch.* attributes are rejected
    Given a customer pushes an OTLP body whose span/log attributes
      include keys starting with "langwatch.origin." or
      "langwatch.governance."
    When the receiver normalizes the payload
    Then those user-supplied attribute values are dropped (not
      passed through) and replaced with the canonical
      receiver-stamped values
    And the receiver MAY emit a soft-warning header indicating
      that reserved-namespace attributes were dropped (defensive
      observability)

  @bdd @architecture @namespaces
  Scenario: langwatch.origin.* describes source identity; langwatch.governance.* describes derived attributes
    When a query returns a span / log carrying langwatch.* attributes
    Then langwatch.origin.* attributes describe WHERE this event
      came from (source identity, kind, organization)
    And langwatch.governance.* attributes describe DERIVED
      governance state (retention class applied, anomaly alert
      that flagged this span, severity classification, etc.)
    And neither namespace is meant for user-supplied trace
      annotations (those use other span attributes)

  # ---------------------------------------------------------------------------
  # Derived projections — folds over the unified store
  # ---------------------------------------------------------------------------

  @bdd @architecture @folds
  Scenario: Governance KPI dashboard reads from a fold projection, not raw spans
    Given the /governance dashboard renders summary cards
      (spend this month, active users, anomaly counts)
    When the dashboard's tRPC procedures execute
      (api.activityMonitor.summary / spendByUser / etc.)
    Then they read from the governance_kpis fold projection
      (org_id, source_id, time_bucket → spend/tokens/event_count)
    And NOT from raw recorded_spans / log_records (full partition
      scans would be expensive at scale)
    And NOT from the deleted gateway_activity_events table

  @bdd @architecture @folds
  Scenario: Anomaly reactor reads from the governance fold, not raw spans
    Given an active AnomalyRule of type "spend_spike"
    When the trace-processing pipeline appends new events to event_log
    Then the anomaly reactor evaluates the rule against the
      governance_kpis fold (cheap rolling-window aggregation)
    And NOT against raw recorded_spans (which would require
      partition scans per evaluation)
    And NOT against the deleted gateway_activity_events table

  @bdd @architecture @folds @ocsf
  Scenario: OCSF read shape is derived from the unified store, not separately stored
    Given a security team queries OCSF-shaped audit events for SIEM forwarding
    When the OCSF read API procedure executes
      (api.governance.exportOcsf or equivalent — see siem-export.feature)
    Then the response rows are derived query-time (or projection-time)
      from recorded_spans + log_records carrying
      langwatch.origin.kind = "ingestion_source"
    And the OCSF Actor / Action / Target / Time / Severity columns
      are mapped from span/log attributes (user.email → Actor,
      span.name → Action, gen_ai.request.model → Target, etc.)
    And NOT stored in a separate OCSF-only table

  # ---------------------------------------------------------------------------
  # Public surfaces — separate URLs allowed only for auth/UX convenience
  # ---------------------------------------------------------------------------

  @bdd @architecture @public-api
  Scenario: Public ingest URLs may be separate, but share internal infrastructure
    Given /api/otel/v1/traces (project API key auth) AND
      /api/ingest/otel/:sourceId (source bearer auth) both exist
    When either URL receives an OTLP body
    Then they share the OTLP read/decompress/parser internals
      (single helper module under langwatch/src/server/otel/)
    And they share the trace/log ingestion pipeline downstream
    And the only differences are: auth shape, tenancy resolution
      (project vs hidden Governance Project lookup), and origin
      metadata stamping

  @bdd @architecture @public-api
  Scenario: Webhook + S3-pull receivers normalize to OTLP before handoff
    Given /api/ingest/webhook/:sourceId (Workato HMAC auth) AND
      future S3 puller receivers (compliance feeds)
    When they receive a platform-specific input
      (webhook envelope JSON, S3 JSONL line, etc.)
    Then they normalize the input to OTLP logs (per source type's
      mapping rule — see Sergey's receiver-shapes.feature)
    And hand to the same trace/log ingestion pipeline
    And NO parallel non-OTLP ingestion path exists internally

  # ---------------------------------------------------------------------------
  # Append-only event_log — durability invariant
  # ---------------------------------------------------------------------------

  @bdd @architecture @event-log
  Scenario: All ingestion writes go through the append-only event_log
    Given any receiver accepts a payload (OTLP, webhook, S3 pull)
    When the receiver hands data to the trace/log pipeline
    Then an append-only event in event_log records the receipt
      (per the existing PR #3351 reactor pattern)
    And projections (recorded_spans, log_records, governance_kpis,
      governance_ocsf_events) are rebuilt from event_log if needed
    And event_log is the durability source of truth (delete a
      projection table → can rebuild from event_log; cannot
      delete event_log)

  # ---------------------------------------------------------------------------
  # Compliance baseline + deferred items
  # ---------------------------------------------------------------------------

  @bdd @architecture @compliance @baseline
  Scenario: This PR's compliance baseline targets SOC2 Type II / ISO 27001 / EU AI Act / GDPR / HIPAA-most-uses
    When the compliance-baseline.feature scenarios are evaluated
      (Andre's spec)
    Then this PR ships:
      | invariant                                            |
      | Append-only event_log (durability)                   |
      | Per-origin retention class (configurable per source) |
      | RBAC via hidden Governance Project membership         |
      | Origin metadata + reserved namespaces                |
      | OCSF read projection (SIEM forwarding via API)       |
    And all of the above are sufficient for the broad enterprise
      market's SOC2 Type II / ISO 27001 / EU AI Act / GDPR /
      HIPAA-most-uses contractual posture

  @bdd @architecture @compliance @deferred
  Scenario: Cryptographic tamper-evidence is filed as follow-up
    When the codebase + docs are inspected
    Then there is NO Merkle-tree integrity table
    And NO cryptographic signing of event_log entries
    And NO tamper-evidence verification API surface
    And the compliance docs (Andre's customer-facing
      compliance-architecture.mdx) explicitly name tamper-evidence
      as the next hardening layer, not part of this PR's baseline
    And this is by design (rchaves + master call: append-only +
      retention + RBAC is sufficient for the broad market;
      cryptographic Merkle proofs are a regulated-industry-specific
      add-on shipped when a customer with that contractual ask is
      in pipeline)

  # ---------------------------------------------------------------------------
  # Branch-correction artifacts — what was deleted
  # ---------------------------------------------------------------------------

  @bdd @architecture @rip-out
  Scenario: The branch-correction deletes the parallel governance backend
    When git log on the feat/governance-platform branch is inspected
    Then there are commits removing:
      - The gateway_activity_events ClickHouse migration
      - The activity-monitor-processing event-sourcing pipeline
        (commands, projections, schemas, store)
      - The bespoke OtlpResourceSpans / OtlpScopeSpans / OtlpSpan
        types in normalizers/otel.ts
      - The activityEvent.repository.ts (ActivityEventRow type)
      - The "representative-project" cache in ingestionRoutes.ts
        (no longer needed once routing flows through hidden Gov Project)
      - The activityMonitor.recordActivityEvent command from app.ts
      - registerActivityMonitorPipeline + activityEventStorage
        wiring from pipelineRegistry + presets
    And subsequent commits rewire receivers, queries, anomaly
      reactor against the unified-store + governance fold
      projections per the locked architecture above
