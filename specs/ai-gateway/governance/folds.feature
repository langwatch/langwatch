Feature: Governance derived streams atop the unified observability store
  The /governance dashboard, anomaly detection, and OCSF SIEM-export read
  paths all consume DERIVED data layered on top of recorded_spans +
  log_records. They are NOT a parallel source of truth; the source of
  truth is the append-only event_log.

  Two derived streams:
    governance_kpis            — per (org, source, hour) → spend / events / tokens
    governance_ocsf_events     — Actor / Action / Target / Time / Severity per event

  Filters: events whose `langwatch.origin.kind = "ingestion_source"` are
  governance data; everything else is normal application traces and is
  excluded.

  # ---------------------------------------------------------------------------
  # HISTORY — why "rebuildable" is a claim this file once could not make.
  #
  # Both streams used to be written by `governanceKpisSync.reactor.ts` and
  # `governanceOcsfEventsSync.reactor.ts`. The projection router never
  # dispatches a reactor on the replay path, so a lost or failed write could not
  # be recovered by rebuilding and drift was permanent — worst of all for
  # governance_ocsf_events, an audit stream that event-log-durability.feature
  # tells auditors derives from the event log.
  #
  # ADR-075 Class C has since converted both to map projections over the spans
  # the streams are derived from, and retired the two reactors. Rebuilding is
  # now the recovery mechanism rather than the target state, which is why the
  # rebuild scenarios below are enforced rather than @unimplemented.
  #
  # Both tables are ReplacingMergeTree, so a rebuild re-deriving a row it
  # already holds collapses onto it instead of adding a second one — that is
  # what makes replay safe to run over an intact window, and it is asserted
  # rather than assumed.
  # ---------------------------------------------------------------------------

  Companion: receiver-shapes.feature,
  event-log-durability.feature, anomaly-detection.feature.
  See dev/docs/adr/075-post-event-work-subscribers-and-process-managers.md.

  Background:
    Given the unified observability substrate is live
    And IngestionSource events stamp `langwatch.origin.kind = "ingestion_source"`

  Rule: governance_kpis powers /governance KPI reads + anomaly detection

    Scenario: a span lands with origin metadata
      Given a Cowork OTel push has just landed in recorded_spans
      And the span's attributes include `langwatch.origin.kind = "ingestion_source"`
      When the trace-processing pipeline records the span
      Then governance_kpis updates the (org_id, source_id, hour_bucket) row
      And the row's spendUsd increments by the span's gen_ai.usage.cost_usd
      And the row's tokensInput / tokensOutput increment by the span's token attributes
      And the row's eventCount increments by 1

    Scenario: a log_record lands with origin metadata
      Given a Workato webhook has just landed as a log_record
      When the pipeline records it
      Then governance_kpis updates the (org, source, hour_bucket) row
      And the row reflects the log_record's cost / token attributes (if present)

    Scenario: anomaly detection reads the derived stream (not raw spans/logs)
      Given a spend_spike rule with windowSec=86400 and ratioVsBaseline=2.0
      When the rule is evaluated after each event
      Then the evaluation queries governance_kpis for the rolling window + baseline
      And it does NOT scan recorded_spans / log_records partitions directly
      And the query is cheap (small denormalised table)

    Scenario: /governance KPI strip reads the derived stream
      Given an admin opens /governance
      When the dashboard loads
      Then the spend KPI reads from governance_kpis with a rolling-window aggregation
      And the source-by-source breakdown reads from the same stream
      And no raw recorded_spans / log_records query runs for the KPI strip

  Rule: governance_ocsf_events powers SIEM export

    Scenario: a governance event derives an OCSF row
      Given a span/log_record lands with origin metadata
      When the pipeline records it
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

  Rule: derived streams are derived data, not source of truth

    # Reachable since ADR-075 Class C: both streams are map projections over
    # the events they derive from, so a rebuild re-runs the same derivation the
    # live write path runs. This is the contract event-log-durability.feature
    # has always told auditors holds, and it now does.

    @integration
    Scenario: A drifted KPI stream is corrected by rebuilding from event_log
      Given the governance_kpis stream has drifted (e.g. CH replica catch-up failure)
      When operators trigger a rebuild from event_log
      Then the rebuild reads append-only events for the affected aggregate
      And produces state identical to the live write path
      And no governance data is lost — the source of truth is event_log + recorded_spans/log_records

    @integration
    Scenario: An audit entry lost to a failure is recovered by rebuilding
      Given governed activity whose OCSF entry was never written
      When the audit stream is rebuilt from event_log
      Then the missing entry is present
      And the auditor cannot tell it was ever absent

    @integration
    Scenario: Rebuilding does not duplicate what is already recorded
      Given an audit stream that is already complete
      When it is rebuilt from the same events
      Then each governed activity is still represented once

    @integration @unimplemented
    Scenario: A stream that has fallen behind can be identified
      Given a derived governance stream
      When it is compared against event_log for a period
      Then any activity present in the log and missing from the stream is reported
      And the report names the period examined

    @integration @unimplemented
    Scenario: A dropped stream does not affect governance data
      Given a CH migration drops governance_kpis temporarily
      When customers continue ingesting events
      Then events still land in recorded_spans / log_records (source of truth)
      And /governance KPIs render zeros until the stream is recreated and rebuilt
      And no event is lost
