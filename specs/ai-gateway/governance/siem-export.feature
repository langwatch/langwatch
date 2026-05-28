# LangWatch AI Gateway Governance — SIEM Export
#
# OCSF read API + lightweight push contract for forwarding governance
# events to enterprise SIEM platforms (Splunk, Datadog Security, AWS
# Security Hub, Microsoft Sentinel, etc.).
#
# Architectural rule (per master_orchestrator locked shape): the SIEM
# export is a DERIVED READ PROJECTION over the unified observability
# store, never a parallel source of truth. The governance_ocsf_events
# fold is rebuilt at any time from event_log; the export tRPC procedure
# returns rows from the fold; optional thin-layer webhook push delivers
# fold rows on a configured cadence.
#
# In-scope this PR: OCSF read API (pull-based; security teams cron
# their SIEM ingest against it). Lightweight push ONLY if it stays a
# thin layer over the read API — webhook delivery infra (retries / DLQ
# / signing / per-org config UI) is filed as immediate follow-up if
# scope balloons.
#
# Source of truth: recorded_spans + log_records (unified observability
# substrate). Derived: governance_ocsf_events fold (per-event OCSF
# Actor/Action/Target/Time/Severity shape).
#
# Companion specs (this file references but does not duplicate):
# - folds.feature                 → governance_ocsf_events fold derivation + cursor pull mechanics
# - retention.feature             → per-origin TTL applied to fold rows in lockstep with source rows
# - event-log-durability.feature  → projection rebuild from event_log; derived-data invariants
# - compliance-baseline.feature   → SOC2/ISO/EU AI Act framework coverage; tamper-evidence deferral
# - architecture-invariants.feature → cross-cutting unified-substrate + folds-as-derived invariants
# - ui-contract.feature           → /governance UI surface (separate from this REST/SIEM-export contract)

Feature: SIEM export — OCSF read projection over the unified governance store

  Background:
    Given the unified observability substrate is the single source of truth for governance events
    And recorded_spans + log_records carry origin metadata in langwatch.origin.*
    And the governance_ocsf_events fold derives Actor / Action / Target / Time / Severity shape at projection time
    And the fold is rebuildable from event_log at any time (no parallel source of truth)
    And cryptographic signatures over export rows are filed to the tamper-evidence follow-up

  # ─────────────────────────────────────────────────────────────────────
  # OCSF read API — the canonical export contract
  # ─────────────────────────────────────────────────────────────────────

  Scenario: Read API exposes the OCSF shape for the orgs governance events
    Given the org has events in the governance_ocsf_events fold
    When an authenticated org admin or auditor calls api.governance.exportOcsf
    Then the response is paginated with cursor "next_cursor"
    And each row carries the canonical OCSF v1.1 fields:
      | field      | semantics                                                           |
      | actor      | actor identity (typically user.email or principal.id)               |
      | action     | OCSF action verb (api.call / tool.invocation / agent.action / auth) |
      | target     | resource the action was performed against (model / tool / endpoint) |
      | time       | event_timestamp_iso (UTC, RFC 3339)                                 |
      | severity   | informational / low / medium / high / critical                      |
      | source     | langwatch.origin.ingestion_source.id (lw_is_<...>)                  |
      | source_type| ingestion source type (otel_generic / claude_cowork / workato / ...)|
      | metadata   | object including cost_usd, tokens_input, tokens_output, raw_payload reference |

  Scenario: Read API filters by org, by source, by time-window, by severity
    Given an authenticated caller queries api.governance.exportOcsf
    Then the caller can filter by IngestionSource.id (single source export)
    And the caller can filter by time-window (since / until ISO)
    And the caller can filter by minimum severity (default: informational)
    And the caller cannot read events outside their org (tenancy invariant)
    And the underlying CH partition pruning makes large time-window exports cheap

  Scenario: Cursor pagination returns deterministic ordering
    Given the org has many governance events
    When a caller paginates through api.governance.exportOcsf via next_cursor
    Then events are returned in (event_timestamp_iso DESC, event_id ASC) order
    And each cursor returns a stable page even if new events are arriving concurrently
    And the caller never sees a duplicate event across pages
    And the caller never misses an event whose timestamp lies inside the pagination window

  Scenario: Auth — only org admin or auditor role can call exportOcsf
    Given a user with role "project_member" but not "org_admin" or "auditor"
    When the user calls api.governance.exportOcsf
    Then the call returns 403 forbidden
    And no events are returned even for the users own project membership
    Given a user with role "org_admin" or "auditor" in the org
    When the user calls api.governance.exportOcsf
    Then the call returns 200 with events paginated per the contract above

  # ─────────────────────────────────────────────────────────────────────
  # SIEM target compatibility
  # ─────────────────────────────────────────────────────────────────────

  Scenario Outline: Major SIEM platforms can ingest the OCSF read shape via cron-pull
    Given a customer security team uses "<siem_platform>"
    When they configure a scheduled pull against api.governance.exportOcsf with cursor pagination
    Then the SIEM ingests rows in OCSF v1.1 shape without per-row reshaping
    And the SIEM correctly extracts actor / action / target / time / severity for downstream alerting

    Examples:
      | siem_platform                |
      | Splunk Enterprise Security   |
      | Datadog Security             |
      | AWS Security Hub             |
      | Microsoft Sentinel           |
      | Elastic Security             |
      | Sumo Logic Cloud SIEM        |

  # ─────────────────────────────────────────────────────────────────────
  # Lightweight push — only if it stays a thin layer
  # ─────────────────────────────────────────────────────────────────────

  Scenario: Optional push delivers OCSF events to a configured webhook
    Given an org configures a SIEM push webhook URL with a shared secret
    And the org configures a delivery cadence (e.g. every 5 minutes)
    When new rows arrive in governance_ocsf_events since the last successful push
    Then a thin worker fetches the new rows via the same read projection
    And POSTs them in OCSF JSON to the configured webhook
    And signs the request with the shared secret (HMAC-SHA256)
    And honours basic exponential-backoff retry on 5xx (max 3 retries)

  Scenario: Push remains a thin layer or it is filed as follow-up
    Given the push implementation needs more than thin-layer infrastructure
    When implementation requires a dedicated delivery worker / DLQ / per-org config UI / delivery guarantees / replay
    Then the team STOPS the thin-layer-push slice
    And files the heavyweight push as an immediate follow-up PR
    And ships only the OCSF READ API in this PR
    And docs explicitly document SIEM forwarding via cron-pull as the supported integration path

  Scenario: Push failures do not lose events at the source of truth
    Given a webhook push fails after exhausting retries
    Then no events are lost — the source-of-truth recorded_spans + log_records still hold them
    And the next pull or push delivery cadence catches up via cursor advancement
    And no parallel write path exists that could leak governance events on push failure

  # ─────────────────────────────────────────────────────────────────────
  # Source-of-truth invariants — no parallel storage
  # ─────────────────────────────────────────────────────────────────────

  Scenario: Export is derived, not written
    Given a governance event is processed end-to-end
    When the event lands in recorded_spans or log_records via the trace-processing pipeline
    And the governance_ocsf_events fold projects the event into OCSF shape
    And api.governance.exportOcsf returns the row
    Then the source of truth for that event is event_log + recorded_spans/log_records, not the OCSF fold
    And rebuilding the OCSF fold from event_log produces an identical row set
    And no API endpoint writes to governance_ocsf_events directly (read-only projection)

  Scenario: Export honours per-origin retention class
    Given an event is tagged with retention_class "operational" (30d)
    When 31 days pass and the underlying recorded_spans row is TTL-pruned
    Then the corresponding governance_ocsf_events row is also pruned by the same TTL policy
    And api.governance.exportOcsf no longer returns the row (consistent with retention contract)

  # ─────────────────────────────────────────────────────────────────────
  # Documentation surface — customer-facing scope
  # ─────────────────────────────────────────────────────────────────────

  Scenario: SIEM export is documented as a derived read shape
    Given the customer-facing docs at docs/ai-gateway/governance/compliance-architecture.mdx
    Then the docs name the OCSF read API as the canonical SIEM integration path
    And the docs name the supported SIEM targets (Splunk / Datadog Sec / AWS Sec Hub / Sentinel / etc)
    And the docs link to the OCSF v1.1 schema for customer reference
    And the docs distinguish "pull via read API (in scope)" from "lightweight push (in scope if thin)" from "full delivery infra (filed follow-up)"

  Scenario: Export does NOT claim cryptographic tamper-evidence
    Given a customer reads the SIEM export docs
    Then the docs do not claim signed-receipts or Merkle-root verification on exported rows
    And the docs link to the planned tamper-evidence ADR for customers needing that hardening layer
    And the existing append-only event_log + retention + RBAC are named as the SOC2 Type II-grade non-repudiation foundation
