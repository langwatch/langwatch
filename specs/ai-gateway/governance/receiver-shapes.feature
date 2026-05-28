Feature: Per-source OTLP shape on /api/ingest/* receivers
  IngestionSource receivers map each source type's wire shape to the
  RIGHT OTLP shape before handing off to the existing trace pipeline.
  Span-shaped sources (real OTel exporters with span tree semantics)
  emit OTLP traces. Flat audit feeds (webhooks, JSONL drops, polled
  audit lines) emit OTLP logs — they are NOT pushed into 0-duration
  synthetic spans.

  Both shapes go through the shared OTLP body parser
  (src/server/otel/parseOtlpBody.ts) and end up in the same internal
  store (recorded_spans / log_records). Origin metadata distinguishes
  governance data; the hidden Governance Project provides tenancy
  context — the receiver never asks the caller to pick a project.

  Implementation: src/server/routes/ingest/ingestionRoutes.ts.
  Companion: architecture-invariants.feature (cross-cutting),
  retention.feature (TTL hook).

  Background:
    Given the org "acme-corp" has a hidden Governance Project as its
      internal governance routing context
    And the IngestionSource bearer secret resolves to a source in that org

  Rule: span-shaped sources land as OTLP traces

    Scenario: otel_generic — generic OTel exporter pushes JSON traces
      Given an IngestionSource of type "otel_generic"
      When the exporter POSTs an OTLP traces body to /api/ingest/otel/<sourceId>
      Then the receiver decompresses the body via the shared parser
      And the receiver parses traces (protobuf or JSON) via the shared parser
      And every span gains attributes:
        | langwatch.origin.kind                       | ingestion_source            |
        | langwatch.ingestion_source.id               | <source.id>                 |
        | langwatch.ingestion_source.organization_id  | <source.organizationId>     |
        | langwatch.ingestion_source.source_type      | otel_generic                |
        | langwatch.governance.retention_class        | <source.retentionClass>     |
      And the receiver hands off via traces.collection.handleOtlpTraceRequest
      And spans land in recorded_spans under the hidden Governance Project's tenant
      And the receiver returns 202 with events count matching the span count

    Scenario: claude_cowork — Anthropic Cowork tenant push
      Given an IngestionSource of type "claude_cowork"
      When Cowork POSTs OTLP traces with tool_use spans
      Then each span gains the same origin attribute set
      And Cowork's tool_use attributes are preserved unchanged on the span
      And spans land in recorded_spans under the hidden Governance Project

  Rule: flat audit feeds land as OTLP logs (NOT synthetic spans)

    Scenario: workato — webhook envelope to /api/ingest/webhook/<sourceId>
      Given an IngestionSource of type "workato"
      When Workato POSTs a JSON envelope with recipe + actor + cost fields
      Then the receiver maps the envelope to ONE OTLP log_record (not a span)
      And the log_record carries the origin attribute set above
      And the log_record's body carries the workato-specific JSON fields
      And the log_record lands in log_records under the hidden Governance Project
      And no entry is added to recorded_spans (flat events do not synthesise spans)
      And the org's trace count is unaffected

    Scenario: s3_custom — pulled JSONL drop maps each line to one log_record
      Given an IngestionSource of type "s3_custom" with a parser DSL
      When the puller reads N lines from the S3 drop
      Then each line maps to one OTLP log_record
      And each log_record carries origin metadata
      And each log_record's timestamp is parsed from the source line, not "now"

    Scenario: openai_compliance / claude_compliance / copilot_studio
      Given an IngestionSource of any pull-based audit type
      When the puller fetches a batch
      Then each event becomes one OTLP log_record (not a synthetic span)
      And origin metadata distinguishes the source

  Rule: receivers are thin auth/routing wrappers, not a parallel pipeline

    Scenario: receiver does NOT write ClickHouse directly
      Given any IngestionSource receiver
      When a body arrives
      Then the receiver only authenticates, parses, stamps origin metadata
      And the receiver hands off to the existing trace/log pipeline
      And the receiver never writes to a governance-specific CH table
      And no `gateway_activity_events` (or similar parallel) table is touched

    Scenario: receiver shares the hardened OTLP parser with /api/otel/v1/traces
      Given gzipped protobuf traffic at production volumes
      When the body arrives at /api/ingest/otel/<sourceId>
      Then decompression handles gzip / deflate / brotli identical to /v1/traces
      And protobuf + JSON + JSON-then-protobuf-encode-fallback all parse correctly

    Scenario: receiver returns 202 with hint when bytes>0 but events=0
      Given a fresh admin curls a malformed body during first-event setup
      When the receiver parses bytes>0 but extracts no spans/logs
      Then the response is 202 with a hint string linking to the canonical OTLP shape docs
      And no row is written to recorded_spans or log_records

  Rule: the receiver does not surface the hidden Governance Project to callers

    Scenario: caller has no project-id concept
      Given the IngestionSource bearer is valid
      When the receiver routes to internal storage
      Then no projectId appears in the receiver's request/response shape
      And no "select your project" affordance exists in the composer or modal
      And the hidden Governance Project resolution is purely internal
