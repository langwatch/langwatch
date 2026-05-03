Feature: AI Gateway Governance — Anomaly alert dispatch (C3)
  As an admin watching governance anomalies
  I want fired AnomalyAlert rows to be POSTed to my SIEM / on-call / Slack / monitoring tools
  So that an off-hours spend spike or compliance signal pages me, not just lands in a dashboard table

  Today (pre-C3), the spendSpikeAnomalyEvaluator persists AnomalyAlert
  rows in Postgres with `detail.dispatch: "log_only"`. C3 ships the
  generic webhook adapter as the minimum viable destination. Slack /
  PagerDuty / email are deferred to follow-up rows; webhook is the
  universal escape hatch (point it at a Slack incoming-webhook URL with
  a small adapter on the receiver side).

  Background:
    Given organization "acme" exists on an Enterprise plan
    And alice is an org ADMIN of "acme" with `anomalyRules:manage`
    And the spend_spike evaluator runs on a schedule

  # ============================================================================
  # destinationConfig validation (mirrors threshold-config Phase 2C)
  # ============================================================================

  @bdd @phase-2c @c3 @validation
  Scenario: Valid webhook destinationConfig persists exactly
    When alice creates a rule with
      """
      destinationConfig:
        destinations:
          - type: webhook
            url: https://hooks.example.com/lw
            sharedSecret: ALICE-LAB
      """
    Then the response is OK
    And the persisted destinationConfig matches input exactly

  @bdd @phase-2c @c3 @validation
  Scenario Outline: Invalid destinationConfig is rejected with BAD_REQUEST
    When alice creates a rule with `<invalid_destination_config>`
    Then the response is BAD_REQUEST naming the invalid field
    And no AnomalyRule is created

    Examples:
      | invalid_destination_config                                                |
      | { destinations: [{ type: "webhook", url: "not-a-url" }] }                 |
      | { destinations: [{ type: "slack", channel: "#ops" }] }  (unknown type)    |
      | { destinations: [{ type: "webhook" }] }  (missing url)                    |
      | { destinations: "https://hooks.example.com" }  (not an array)             |

  # ============================================================================
  # Dispatch happy path
  # ============================================================================

  @bdd @phase-2c @c3 @dispatch
  Scenario: Fired alert POSTs structured JSON to every configured webhook
    Given alice's rule has destinations
      | type     | url                                |
      | webhook  | https://hooks.example.com/primary  |
      | webhook  | https://hooks.example.com/backup   |
    When the evaluator fires an alert for that rule
    Then both webhook URLs receive a POST with `Content-Type: application/json`
    And the body contains
      """
      {
        "ruleId": "...",
        "ruleName": "...",
        "ruleType": "spend_spike",
        "severity": "warning",
        "organizationId": "...",
        "alert": {
          "id": "...",
          "triggerWindowStartIso": "...",
          "triggerWindowEndIso": "...",
          "triggerSpendUsd": "...",
          "detail": { ... }
        }
      }
      """
    And the persisted AnomalyAlert.detail.dispatch records the per-destination
      outcomes (e.g. `dispatched_webhook_2`)

  # ============================================================================
  # HMAC signature
  # ============================================================================

  @bdd @phase-2c @c3 @hmac
  Scenario: Webhook with sharedSecret signs the body with HMAC-SHA256
    Given alice's rule has one webhook destination with `sharedSecret: "S3CR3T"`
    When the dispatcher fires
    Then the POST includes header `X-LangWatch-Signature: sha256=<hex>`
    And the hex value equals HMAC-SHA256(body, "S3CR3T")
    And a webhook without `sharedSecret` omits the header entirely

  # ============================================================================
  # Resilience
  # ============================================================================

  @bdd @phase-2c @c3 @retry
  Scenario: Transient HTTP failure is retried with bounded backoff
    Given the webhook returns 503 on the first POST and 200 on the second
    When the dispatcher fires
    Then the dispatcher retries up to 2 times with short backoff
    And the AnomalyAlert is marked `dispatched_webhook_1` after the second attempt succeeds

  @bdd @phase-2c @c3 @best-effort
  Scenario: Permanent dispatch failure does NOT prevent persistence
    Given the webhook always returns 500
    When the evaluator fires
    Then the AnomalyAlert is still persisted in PG
    And `detail.dispatch` records the failure (`failed_webhook_1: <reason>`)
    And the dashboard's `recentAnomalies` query still surfaces the alert
    # Best-effort: dispatch is observability, not the source of truth.
    # The alert row itself is the authoritative signal.

  @bdd @phase-2c @c3 @no-destinations
  Scenario: A rule with no destinations falls back to log-only behavior
    Given alice's rule has no `destinations` array (or an empty one)
    When the evaluator fires
    Then the AnomalyAlert is persisted with `detail.dispatch: "log_only"`
    And no HTTP POST is attempted
    # Same shape as before C3 — admin opted out of dispatch.

  # ============================================================================
  # Quarantine of stale destinationConfig
  # ============================================================================

  @bdd @phase-2c @c3 @quarantine
  Scenario: Legacy destinationConfig that fails strict validation is treated as no-destinations
    Given a legacy rule has a destinationConfig that pre-dates the schema
      (e.g. `{ slack_channel: "#ops" }` — bare object, not an array)
    When the evaluator fires
    Then the dispatcher logs a warning naming the rule id + Zod issues
    And no HTTP POST is attempted
    And the AnomalyAlert is still persisted with `detail.dispatch: "log_only_invalid_config"`
    # Mirrors the threshold-config quarantine path from `1f4ddd04c`:
    # broken config doesn't crash the evaluator and doesn't silently
    # default — it logs and falls back to log-only.
