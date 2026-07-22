Feature: Event-sourced custom-graph threshold alerts
  As an operator running custom-graph threshold alerts
  I want them to fire in near real time and resolve on their own
  So that alerts stay timely and trustworthy.

  # The event-sourced path is the sole graph-alert path: the real-time outbox
  # reactor fires on fold updates and the 30s heartbeat covers no-data and
  # resolve. The K8s cron that used to share this work was removed once every
  # project had cut over (ADR-034).
  #
  # Silence (ADR-063, specs/automations/silence.feature): a silenced trigger
  # keeps evaluating and recording incidents, but its notifications are
  # suppressed until the silence expires. These scenarios assume an
  # unsilenced trigger.

  Background:
    Given a project owns active custom-graph triggers
    And every trigger writes to the same `Trigger` and `TriggerSent` tables

  Scenario: threshold breaches in real time
    When new traces land that move the metric across the threshold
    Then a notification is sent within a few seconds of the breach
    And one `TriggerSent` row is recorded for the incident

  Scenario: metric goes silent — no-data alert fires
    Given a graph trigger is configured to fire when the metric drops to zero
    When the project sees no qualifying events for the trigger's window
    Then the heartbeat fires the alert within thirty seconds
    And the notification names the metric and the no-data condition

  Scenario: a below-threshold alert fires on total silence
    Given a graph trigger is configured to fire when the metric is below ten
    When the project's traffic stops entirely
    Then the heartbeat fires the alert
    And no real-time event is needed to wake the evaluation

  Scenario: traffic stops while the alert is firing — resolve via heartbeat
    Given a graph alert is currently firing with an unresolved `TriggerSent`
    When the metric stays below the threshold and traffic stops
    Then the heartbeat resolves the alert within thirty seconds
    And the unresolved `TriggerSent` is marked resolved

  Scenario: rapid re-evaluation does not re-notify
    Given a graph alert is currently firing
    When the evaluator runs again within the debounce window
    Then no second notification is sent for the same incident
    And the `TriggerSent` count for the incident stays at one

  Scenario: an outbox retry does not re-fire the same incident
    Given a graph alert has fired and the operator has been notified
    When the outbox retries the same fire
    Then no second notification is sent
    And the incident's `TriggerSent` claim is honored so the retry no-ops

  Scenario: graph alert notification uses the alert-default template
    Given the trigger has no custom Liquid templates
    When the alert fires
    Then the notification subject reads as a metric-crossed-threshold alert
    And the notification body describes the graph and the breach
    And not the trace-iteration default used for trace-based triggers

  Scenario: graph alert custom template still overrides the alert default
    Given the operator has authored a custom email subject template for the trigger
    When the alert fires
    Then the notification subject renders the operator's template
    And the alert-default template is not used

  Scenario: graph alert templates receive the graph's data, not trace data
    When the alert fires
    Then the template context carries the metric's recent numeric history
    And a prebuilt trend sparkline of that history
    And the metric's value over the preceding window
    And no trace matches are present in the context

  Scenario: graph alert notification links to the incident window
    When the alert fires
    Then the notification's dashboard link opens the graph at the window the breach was evaluated over
    And not at the time the reader clicks the link

  Scenario: previewing or test-firing a graph alert renders the alert shape
    Given the operator is authoring a graph alert in the automations drawer
    When they preview the templates or send a test notification
    Then the rendered output uses the alert-default templates and an example alert context
    And not the trace-iteration example used for trace-based automations

  Rule: eval-metric graph triggers fire on the same event-sourced path

    Eval-metric custom-graph triggers (`evaluations.evaluation_score`,
    `evaluations.evaluation_pass_rate`, `evaluations.evaluation_runs`) run on
    the same real-time path and heartbeat, source-aware so the recency check
    queries `evaluation_analytics` instead of `trace_analytics`.

    Scenario: eval-metric threshold breaches in real time
      Given a graph trigger watches an evaluation-score metric
      When new evaluations land that move the metric across the threshold
      Then a notification is sent within a few seconds of the breach
      And one `TriggerSent` row is recorded for the incident

    Scenario: eval-metric goes silent — no-data alert fires from heartbeat
      Given a graph trigger watches an eval-pass-rate metric configured to fire when it drops to zero
      When the project sees no qualifying evaluations for the trigger's window
      Then the heartbeat fires the alert within thirty seconds
      And the heartbeat's recency check queries the evaluation analytics table, not the trace one
      And the notification names the metric and the no-data condition

    Scenario: mixed trace + eval triggers — one query per source per project per tick
      Given the project owns one trace-metric graph trigger and one eval-metric graph trigger
      When the heartbeat ticks
      Then it issues exactly one recency query against the trace analytics table
      And exactly one recency query against the evaluation analytics table
      And does not issue any cross-source query
