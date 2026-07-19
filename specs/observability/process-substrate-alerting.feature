# See dev/docs/adr/054-observability-as-code-for-the-process-substrate.md
# for the architectural rationale (alerts in the chart, dashboards in repo).
Feature: The process substrate tells operators when it is in trouble

  The process-manager substrate (durable wakes, lease-fenced outbox) is
  designed to degrade quietly in the product: runs self-heal, intents
  retry, duplicates are suppressed. Quiet degradation must therefore be
  loud for operators — every deployment ships alert rules for the
  substrate's failure modes, and the signals those rules need are
  measured, not inferred from logs.

  Scenario: A dead-lettered process intent raises an alert
    Given a process intent has exhausted its delivery attempts
    When the alert rules evaluate
    Then an alert fires identifying the process it belongs to
    And the alert persists until an operator intervenes or the intent is replayed

  Scenario: Wakes firing late raise an alert before a day is lost
    Given process wake-ups are being handled long after their scheduled instant
    When the sustained delay crosses the alerting threshold
    Then an alert fires naming the affected process
    And a single late wake after a deploy does not page anyone

  Scenario: A stalling outbox raises an alert while intents still wait
    Given committed intents are sitting undispatched well beyond the normal drain time
    When the alert rules evaluate
    Then an alert fires before the intents' work is abandoned as stale

  Scenario: Suppressed duplicate intents are visible as a trend
    Given commits are repeatedly dropping intents as already-dispatched
    Then the rate is measured per process
    And a sustained rate raises an alert, because that silence is how a scheduling bug hides

  Scenario: A topic clustering run that finally fails is counted, not just logged
    Given a clustering page fails its last delivery attempt
    Then the failure increments a run outcome metric
    And an alert fires for final failures
    And a skipped run counts as skipped, never as a failure

  Scenario: Every alert ships with the deployment that ships the metrics
    Given a vanilla helm install with metrics enabled
    Then the alert rules are loaded by the bundled Prometheus
    And an operator can opt out with a single value
    And where alerts are routed remains the operator's choice

  Scenario: Dashboards live next to the metrics they read
    Given the repo defines the substrate and topic clustering dashboards
    Then each dashboard imports into any Grafana pointed at the deployment's Prometheus
    And a metric change and its dashboard change land in the same review
