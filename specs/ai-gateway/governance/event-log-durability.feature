Feature: Append-only event_log durability for governance ingestion
  The compliance posture for SOC2 Type II / ISO 27001 / EU AI Act / GDPR
  / HIPAA-most-uses rests on the existing append-only `event_log`
  infrastructure (PR #3351 reactor pattern), not on a separate audit
  store. Every span / log_record landing in the unified substrate is
  produced by an event in event_log; folds and read projections are
  derived from those events; the source of truth is the event log.

  This spec captures the durability invariants customers (and their
  auditors) can rely on. Cryptographic tamper-evidence (Merkle root
  publication, signing keys) is a SEPARATE follow-up hardening layer
  filed for the regulated-industry segment — explicitly NOT shipped
  in this PR.

  Companion: folds.feature, retention.feature, compliance-baseline.feature.

  Background:
    Given the unified observability substrate is live
    And the existing event_log infrastructure is healthy

  Rule: every governance event passes through event_log

    Scenario: an IngestionSource OTLP traces push appends to event_log
      Given an OTel exporter pushes one span to /api/ingest/otel/<sourceId>
      When the receiver hands off to the existing trace pipeline
      Then a SpanRecorded (or equivalent) event lands in event_log
      And the event is durably persisted before the receiver returns 202
      And the span subsequently appears in recorded_spans via the map projection

    Scenario: a webhook envelope appends to event_log
      Given a Workato webhook posts an envelope
      When the receiver maps to a log_record and hands off
      Then a LogRecorded (or equivalent) event lands in event_log
      And the durable persistence guarantee is identical to the OTLP traces path

  Rule: event_log is append-only — no mutation, no deletion via API

    Scenario: an admin cannot delete a governance event via product surfaces
      Given a span/log_record landed via IngestionSource is in the store
      When the admin attempts to delete it
      Then no product API surface (UI, tRPC, REST) permits in-place deletion
      And the only data-removal path is CH TTL eval per the retention class

    Scenario: an admin cannot retroactively edit a governance event's attributes
      Given a span/log_record landed via IngestionSource is in the store
      When the admin attempts to mutate a `langwatch.origin.*` or `langwatch.governance.*` attribute
      Then no product API surface permits the edit
      And the system-derived attributes are immutable from the customer's perspective

    Scenario: GDPR right-to-erasure is the documented exception
      Given a customer invokes GDPR right-to-erasure for a specific user
      When platform operators run the documented erasure procedure
      Then the affected events are tombstoned (not silently mutated)
      And an erasure-audit-trail is recorded
      And the erasure procedure is described in the customer-facing compliance doc

  Rule: folds and reads are rebuildable from event_log

    Scenario: a fold drift triggers rebuild
      Given the governance_kpis fold has drifted (replication delay, CH outage, etc.)
      When operators trigger a rebuild
      Then the rebuild reads events from event_log for the affected aggregate
      And produces identical fold state to a fresh write path
      And the read API resumes serving correct values without data loss

  Rule: cryptographic tamper-evidence is a deferred hardening layer

    Scenario: tamper-evidence is documented as filed-not-shipped
      Given a customer asks "do you publish a Merkle root for tamper-proof audit?"
      Then the compliance doc names this as a follow-up hardening layer for the regulated-industry segment
      And the doc explicitly does NOT claim cryptographic tamper-evidence is in this PR
      And the deferred design references the existing append-only event_log as the foundation

    Scenario: this PR's compliance bar is documented honestly
      Given the customer asks which frameworks are met today
      Then the answer names: SOC2 Type II / ISO 27001 / EU AI Act / GDPR / HIPAA-most-uses
      And the answer names what's deferred: SEC 17a-4-grade cryptographic Merkle proofs
      And neither the docs nor the PR description overclaim tamper-evidence as shipped
