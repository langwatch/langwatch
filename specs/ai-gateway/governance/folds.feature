Feature: Governance fold projections atop the unified observability store
  The /governance dashboard, anomaly reactor, and OCSF SIEM-export read
  paths all consume DERIVED data — fold projections layered on top of
  recorded_spans + log_records. The folds are NOT a parallel source of
  truth; they are pre-aggregated read shapes rebuildable at any time
  from the append-only event_log.

  Two folds ship in this PR:
    governance_kpis            — per (org, source, hour) → spend / events / tokens
    governance_ocsf_events     — Actor / Action / Target / Time / Severity per event

  Both folds register on the existing trace-processing event-sourcing
  pipeline (PR #3351 reactor pattern). They observe span/log writes and
  update derived rows. Filters: events whose `langwatch.origin.kind =
  "ingestion_source"` are governance data; everything else is normal
  application traces and is excluded from the governance folds.

  Companion: receiver-shapes.feature, retention.feature,
  event-log-durability.feature, anomaly-detection.feature.

  Background:
    Given the unified observability substrate is live
    And IngestionSource events stamp `langwatch.origin.kind = "ingestion_source"`

  Rule: governance_kpis fold powers /governance KPI reads + anomaly reactor

    Scenario: a span lands with origin metadata
      Given a Cowork OTel push has just landed in recorded_spans
      And the span's attributes include `langwatch.origin.kind = "ingestion_source"`
      When the trace-processing pipeline emits the post-fold reactor event
      Then the governance_kpis fold updates the (org_id, source_id, hour_bucket) row
      And the row's spendUsd increments by the span's gen_ai.usage.cost_usd
      And the row's tokensInput / tokensOutput increment by the span's token attributes
      And the row's eventCount increments by 1

    Scenario: a log_record lands with origin metadata
      Given a Workato webhook has just landed as a log_record
      When the post-fold reactor fires
      Then the governance_kpis fold updates the (org, source, hour_bucket) row
      And the row reflects the log_record's cost / token attributes (if present)

    Scenario: the anomaly reactor reads the fold (not raw spans/logs)
      Given a spend_spike rule with windowSec=86400 and ratioVsBaseline=2.0
      When the reactor evaluates after each event
      Then the reactor queries governance_kpis for the rolling window + baseline
      And the reactor does NOT scan recorded_spans / log_records partitions directly
      And the query is cheap (small denormalised table)

    Scenario: /governance KPI strip reads the fold
      Given an admin opens /governance
      When the dashboard loads
      Then the spend KPI reads from governance_kpis with a rolling-window aggregation
      And the source-by-source breakdown reads from the same fold
      And no raw recorded_spans / log_records query runs for the KPI strip

  Rule: governance_ocsf_events fold powers SIEM export

    Scenario: a governance event derives an OCSF row
      Given a span/log_record lands with origin metadata
      When the post-fold reactor fires
      Then governance_ocsf_events emits a row with:
        | actor    | derived from langwatch.user.id / user.email / enduser.id          |
        | action   | derived from span.name or log_record body                          |
        | target   | derived from gen_ai.request.model / tool.name / model              |
        | time     | the event's timestamp                                              |
        | severity | "info" by default; elevated when `langwatch.governance.anomaly_alert_id` set |
        | event_id | the span_id (hex) or log_record id                                 |

    Scenario: SIEM client pulls OCSF events on a cursor
      Given a security team has a cron job pulling /api/governance/ocsf-export
      When the client requests rows since cursor T
      Then the response returns OCSF rows from governance_ocsf_events with timestamp > T
      And rows are paginated by event_time
      And the response is read-only (no side effects on the source-of-truth store)

  Rule: folds are derived data, not source of truth

    Scenario: fold rebuild from event_log
      Given the governance_kpis fold has drifted (e.g. CH replica catch-up failure)
      When operators trigger a fold rebuild from event_log
      Then the rebuild reads append-only events for the affected aggregate
      And produces an identical fold state to a fresh write path
      And no governance data is lost — the source of truth is event_log + recorded_spans/log_records

    Scenario: a fold drop does not affect governance data
      Given a CH migration drops governance_kpis temporarily
      When customers continue ingesting events
      Then events still land in recorded_spans / log_records (source of truth)
      And /governance KPIs render zeros until the fold is recreated and rebuilt
      And no event is lost
