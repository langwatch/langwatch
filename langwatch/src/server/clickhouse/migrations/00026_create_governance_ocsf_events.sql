-- +goose Up
-- +goose ENVSUB ON
--
-- governance_ocsf_events fold projection — per-trace OCSF v1.1 row
-- powering SIEM forwarding (Splunk HEC / Datadog Cloud SIEM /
-- Microsoft Sentinel / AWS Security Hub / Elastic Security / Sumo
-- Logic CSE / Google Chronicle). OCSF is the Linux-Foundation-
-- governed Open Cybersecurity Schema Framework adopted by every
-- major SIEM vendor; OWASP AOS extends the API Activity (6003) class
-- specifically for AI agent events, which is what we emit here.
--
-- TenantId is the org's hidden internal_governance Project ID — same
-- tenancy boundary as governance_kpis (3b). Per CLAUDE.md, every CH
-- query MUST include TenantId; this fold inherits that contract.
--
-- Engine: ReplacingMergeTree(LastUpdatedAt) ORDER BY (TenantId, EventId).
-- Each governance span/log emits ONE OCSF row keyed by (TenantId,
-- EventId). EventId is the span_id (hex) for span-shaped traces and
-- the log record id for flat-event traces. Replays of the same event
-- collapse at merge time via dedup-by-key — the populating reactor
-- (3d-ii) can fire multiple times for the same event without
-- duplicate-counting.
--
-- Reads (3f SIEM export tRPC procedure):
--   SELECT * FROM governance_ocsf_events
--    WHERE TenantId = X AND EventTime > {cursor} ORDER BY EventTime LIMIT N
-- Cursor pagination by EventTime — security teams pull on cron.
--
-- Why ReplacingMergeTree (not SummingMergeTree like governance_kpis):
-- governance_kpis is per-(SourceId, HourBucket, TraceId) summable
-- contributions. governance_ocsf_events is per-event facts (one event
-- = one OCSF row); replays are structurally idempotent via the EventId
-- key and there's nothing to sum.
--
-- Source-of-truth invariant: this fold is DERIVED data only. The
-- append-only event_log + recorded_spans + log_records remain the
-- source of truth. The fold can be dropped + rebuilt at any time
-- from event_log without data loss (per ADR-018).
--
-- Spec: specs/ai-gateway/governance/folds.feature §"governance_ocsf_events"
-- + specs/ai-gateway/governance/siem-export.feature

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.governance_ocsf_events
(
    -- identity (per-event)
    TenantId String CODEC(ZSTD(1)),
    EventId String CODEC(ZSTD(1)),

    -- correlation back to source-of-truth tables
    TraceId String CODEC(ZSTD(1)),
    SourceId String CODEC(ZSTD(1)),
    SourceType LowCardinality(String),

    -- OCSF v1.1 / OWASP AOS top-level fields
    -- ClassUid 6003 = API Activity (the OWASP-AOS-extended class for
    -- agent events). CategoryUid 6 = Application Activity. ActivityId
    -- 1=create / 2=read / 3=update / 4=delete / 6=invoke (we use 6 for
    -- LLM invocations, 1 for agent creation, etc.). TypeUid is computed
    -- = ClassUid*100 + ActivityId per OCSF spec.
    ClassUid UInt32 DEFAULT 6003 CODEC(ZSTD(1)),
    CategoryUid UInt32 DEFAULT 6 CODEC(ZSTD(1)),
    ActivityId UInt8 DEFAULT 6 CODEC(ZSTD(1)),
    TypeUid UInt32 CODEC(ZSTD(1)),

    -- Severity: 1=info, 3=low (warning), 4=medium, 5=high, 6=critical
    -- Default 1 (info); elevated when langwatch.governance.anomaly_alert_id set.
    SeverityId UInt8 DEFAULT 1 CODEC(ZSTD(1)),

    -- Event time (Unix ms, 1:1 with span/log occurredAt)
    EventTime DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- Actor (the principal performing the action)
    ActorUserId String CODEC(ZSTD(1)),
    ActorEmail String CODEC(ZSTD(1)),
    ActorEnduserId String CODEC(ZSTD(1)),

    -- Action (the verb)
    ActionName String CODEC(ZSTD(1)),

    -- Target (what the action operated on — model / tool / agent)
    TargetName String CODEC(ZSTD(1)),

    -- Anomaly correlation — when set, the OCSF row references the
    -- AnomalyAlert row ID (PG) so SIEM consumers can pull both
    -- timelines together.
    AnomalyAlertId String CODEC(ZSTD(1)),

    -- Full OCSF JSON for replay / future-schema-version handling.
    -- Verbose but compresses well; SIEM export reads JSON directly.
    RawOcsfJson String CODEC(ZSTD(3)),

    -- timestamps
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    LastUpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    -- indexes
    INDEX idx_event_time EventTime TYPE minmax GRANULARITY 1,
    INDEX idx_source_id SourceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_actor_email ActorEmail TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_anomaly_alert AnomalyAlertId TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_severity SeverityId TYPE set(8) GRANULARITY 4,
    INDEX idx_tenant_event (TenantId, EventId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}LastUpdatedAt)
PARTITION BY toYYYYMM(EventTime)
ORDER BY (TenantId, EventId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down
-- Down migration intentionally not provided — dropping
-- governance_ocsf_events is supported (the fold is derived data,
-- rebuildable from event_log) but we don't ship it as an automated
-- down because doing so by accident would silently break SIEM
-- forwarding. To roll back: uncomment the DROP statement below
-- and run manually after coordinating with operators.
--
-- -- +goose StatementBegin
-- -- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.governance_ocsf_events;
-- -- +goose StatementEnd
