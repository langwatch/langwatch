Feature: Anomaly detection — evaluate AnomalyRules + dispatch alerts (event-sourced)
  Once admins author AnomalyRules
  (specs/ai-gateway/governance/anomaly-rules.feature) the detection
  reactor evaluates each active rule **as new events arrive** through
  the activity-monitor event-sourcing pipeline (modeled on PR #3351's
  alertTrigger pattern — event sourcing is the one true way per
  rchaves's 2026-04-27 directive). NO cron polling, NO worker —
  evaluation is reactive: receiver appends `ActivityEventReceived`
  to event_log → activity-monitor pipeline projects to
  `gateway_activity_events` and folds rolling windows → anomaly
  reactor reads fold state, evaluates active rules, persists
  `AnomalyAlert` and dispatches.

  Triggered rules persist to `AnomalyAlert` so the admin oversight
  dashboard (`api.activityMonitor.recentAnomalies`) shows real
  detections. Dispatch reuses the shared trigger-action dispatch
  pattern (`pipelines/shared/triggerActionDispatch.ts`).

  v1 scope: two rule types — `spend_spike` and `after_hours` —
  both map cleanly to existing `gateway_activity_events` fields
  (CostUSD, Actor, EventTimestamp). Generic webhook + log-only
  dispatch. Slack / PagerDuty / SIEM / email destinations ship in
  follow-up dispatcher slices.

  Sliced delivery (per @master_orchestrator's C0/C1/C2/C3):
    - C0: this spec + activity-monitor event-sourcing architecture note
    - C1: receiver → event_log append → projection reactor → CH row
    - C2: AnomalyAlert schema + anomaly reactor for ONE rule type
    - C3: dispatch destinations beyond log-only

  Spec: this file
  Pairs with: anomaly-rules.feature (configuration entity)
              docs/ai-gateway/governance/architecture.md
              (Activity-monitor event sourcing section)
  Backend: langwatch/src/server/event-sourcing/pipelines/activity-monitor-processing/

  Background:
    Given the org admin has authored at least one active AnomalyRule
      (via api.anomalyRules.create from the /settings/governance/anomaly-rules UI)
    And the IngestionSource for that rule's scope has been emitting
      events for the past 30 days

  Scenario: spend_spike rule fires when ratio exceeds threshold
    Given an active rule "Daily spend spike" with:
      | severity         | warning                                     |
      | ruleType         | spend_spike                                 |
      | scope            | source                                      |
      | scopeId          | <ingestion source id>                       |
      | thresholdConfig  | {windowSec: 86400, ratioVsBaseline: 2.0,   |
      |                  |  minBaselineUsd: 10}                        |
    When the windowed spend (last 24h) exceeds the trailing-7d
      same-window baseline by 2.0× AND baseline >= USD 10
    Then a new AnomalyAlert row is inserted with state="open",
      severity="warning", ruleId set, triggerSpendUsd populated
    And the alert appears in `api.activityMonitor.recentAnomalies` for the org
    And the rule's destinationConfig.webhook (if set) receives a POST
      with the OCSF-style alert payload
    And duplicate alerts for the same window are deduplicated by
      (ruleId, triggerWindowStart) so a re-evaluation in the same
      window updates the existing row rather than creating a second

  Scenario: after_hours rule fires on out-of-window activity
    Given an active rule "Off-hours surge" with:
      | severity         | critical                                       |
      | ruleType         | after_hours                                    |
      | scope            | organization                                   |
      | scopeId          | <organization id>                              |
      | thresholdConfig  | {startHour: 18, endHour: 6, timezone: "UTC",  |
      |                  |  requestsThreshold: 100, windowSec: 3600}      |
    When the rolling 1h request count outside business hours (18:00 → 06:00 UTC)
      exceeds 100
    Then a new AnomalyAlert is inserted with severity="critical"
    And the alert detail includes the contributing actors list (top 5)
    And `recentAnomalies` returns the alert ordered by detectedAt DESC

  Scenario: dispatched generic webhook payload has the canonical shape
    Given a rule with destinationConfig.webhook = { url: "https://hooks.example/anomaly", authHeader: "Bearer s3cr3t" }
    When the rule fires
    Then a POST to the webhook URL is sent with:
      | header               | value                          |
      | Authorization        | Bearer s3cr3t                  |
      | Content-Type         | application/json               |
    And the body is JSON with fields:
      | type             | anomaly_alert                  |
      | alertId          | <AnomalyAlert.id>              |
      | ruleId           | <AnomalyRule.id>               |
      | ruleName         | <AnomalyRule.name>             |
      | severity         | <AnomalyRule.severity>         |
      | ruleType         | <AnomalyRule.ruleType>         |
      | organizationId   | <org id>                       |
      | scope            | <AnomalyRule.scope>            |
      | scopeId          | <AnomalyRule.scopeId>          |
      | triggerWindowStart | ISO8601                      |
      | triggerWindowEnd   | ISO8601                      |
      | triggerSpendUsd  | numeric                        |
      | triggerEventCount| integer                        |
      | detail           | { ... per-rule-type ... }      |
    And dispatch failures (4xx/5xx/timeout) record `destinationStatus`
      = { lastAttemptIso, lastError, attemptCount } on the alert row
    And dispatch failures don't roll back the alert's persistence
      (we still want it in the dashboard)

  Scenario: log-only dispatch when no destination is configured
    Given a rule with destinationConfig = {} (no webhook / Slack / etc)
    When the rule fires
    Then the alert is persisted (still visible in `recentAnomalies`)
    And a structured log line is written at WARN level with the alert payload
    And no external dispatch attempt is made

  Scenario: api.anomalyRules.evaluateNow is a test/dogfood harness only
    Given an admin wants to test their newly-authored rule without
      waiting for a real event to arrive
    When they call `api.anomalyRules.evaluateNow({ id: <ruleId> })`
    Then a synthetic ActivityEventReceived event is appended to event_log
      against the rule's scope (the production code path — the reactor
      processes it identically to a real ingest)
    And the call returns { triggered: boolean, alertId?: string }
    And subsequent UI poll of `recentAnomalies` reflects the result
    And this is explicitly NOT the production architecture: production
      evaluation is reactor-on-event-append, never poller-on-cron.

  Scenario: disabled rules are not evaluated
    Given a rule with status="disabled"
    When the anomaly-detection reactor fires for an event in the rule's scope
    Then the rule is skipped during the in-memory active-rules loop
    And no alert is generated even if the underlying data would trigger

  Scenario: Tenant isolation — alerts are scoped to one org
    Given two orgs both have spend_spike rules that fire concurrently
    When acme-corp's admin queries `recentAnomalies`
    Then only acme-corp's alerts are returned
    And no cross-org alert leakage at any layer (PG WHERE OrganizationId,
      CH WHERE OrganizationId on the spend query)

  Scenario: Backend keeps evaluating when UI is gated off
    Given a customer org doesn't have the governance preview flag enabled
    When their AnomalyRules still have status="active"
    Then the anomaly-detection reactor still fires on every
      ActivityEventReceived event
    And alerts persist as usual
    And dispatch destinations still receive notifications
    And the alerts surface the moment the org enables the flag
    (Same gating contract as activity ingestion: backend always-on,
     UI-gated only.)
