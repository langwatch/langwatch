# ADR-018: Governance ingestion uses the unified observability substrate

**Date:** 2026-04-27

**Status:** Accepted

## Context

Governance ingests OTLP agent activity, webhook audit events, object-store
batch feeds and pull-based compliance feeds. A parallel parser, event pipeline
and ClickHouse store would duplicate retention, tenancy, dashboards, alerts and
operational debugging for data that customers still understand as traces and
logs.

## Decision

Governance origin is metadata on the shared trace and log substrates, not a
second observability system.

### One parser and one pair of stores

- Span-shaped activity uses the hardened OTLP parser and trace-processing
  pipeline and lands in `recorded_spans`.
- Flat audit records normalize to OTLP log records, use the log-processing
  pipeline and land in `log_records`.
- Public project-keyed OTLP routes and governance source-keyed routes differ in
  authentication and routing only. They call the same parsing and pipeline
  services after that boundary.

### Origin metadata is server-owned

The receiver stamps:

```text
langwatch.origin.kind = ingestion_source
langwatch.ingestion_source.id
langwatch.ingestion_source.organization_id
langwatch.ingestion_source.source_type
langwatch.governance.retention_class
```

User-supplied values in these namespaces are rejected or stripped before the
server-owned values are applied. Product queries may filter by this metadata
without selecting a different physical observability store.

### A hidden project provides the tenancy anchor

Each organization with governance ingestion has one project of kind
`internal_governance`. It is created idempotently when the first ingestion
source is created and is reused by later sources.

The project is an internal routing and tenancy artifact. Normal organization,
team and project listings exclude it. Governance services use one
`ensureHiddenGovernanceProject` seam; no receiver or reader invents another
lazy-creation path.

### Derived views are ordinary projections

Governance KPI and OCSF views are projections from the canonical trace/log
events. Anomaly evaluation is a named projection subscriber over the committed
derived view. These views are rebuildable from `event_log`; the subscriber is
excluded from replay so rebuilding data cannot send an alert.

### Retention is selected by trusted source policy

`IngestionSource.retentionClass` selects the permitted ClickHouse retention
class. The receiver derives it from the authenticated source record. An event
cannot request its own retention tier through user attributes.

Supported source shapes are:

| Source | Delivery | Normalized shape |
|---|---|---|
| generic OTLP | push | spans |
| Claude Cowork | push | spans |
| Workato | webhook | logs |
| custom object-store feed | batch/callback | logs |
| Copilot Studio compliance | pull | logs |
| OpenAI compliance | pull | logs |
| Claude compliance | pull | logs |

## Alternatives considered

A parallel governance store gives the feature an apparently isolated schema,
but forces customers and operators to query two versions of the same trace and
duplicates mature tenancy and retention controls. Sharing tables while keeping
a parallel parser still duplicates the most security-sensitive normalization
path. Creating internal projects for every organization would add invisible
rows for organizations that never ingest governance data.

## Consequences

- Governance traces and logs use the same viewers, query language, dashboards
  and alerts as SDK-ingested observability data.
- Parser fixes and reserved-attribute defenses apply to every route.
- Retention and tenancy reuse the standard project-scoped controls.
- The hidden governance project must stay filtered from general project
  surfaces.
- Source-specific adapters normalize at the edge and do not create another
  event vocabulary or analytical store.
