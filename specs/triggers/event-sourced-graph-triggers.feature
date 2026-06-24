Feature: Event-sourced custom-graph threshold alerts
  As an operator running custom-graph threshold alerts
  I want them to fire in near real time, resolve on their own,
  and not double-fire while I'm rolling out the new path
  So that I get timely, trustworthy alerts during and after the migration.

  Background:
    Given a project owns active custom-graph triggers
    And every trigger writes to the same `Trigger` and `TriggerSent` tables
    And the operator can toggle the project onto the event-sourced path
      via the `release_es_graph_triggers_firing` flag

  Scenario: flag off, threshold breaches via cron
    Given the project is on the legacy path
    And the K8s cron runs every three minutes
    When a custom-graph metric crosses its threshold
    Then the cron processes the trigger
    And one notification is sent for that incident
    And the new event-sourced path does not enqueue any evaluation

  Scenario: flag on, threshold breaches in real time
    Given the project is on the event-sourced path
    And the cron does not handle this project's graph triggers
    When new traces land that move the metric across the threshold
    Then a notification is sent within a few seconds of the breach
    And one `TriggerSent` row is recorded for the incident
    And the cron skip is logged for the project's graph triggers

  Scenario: flag on, metric goes silent — no-data alert fires
    Given the project is on the event-sourced path
    And a graph trigger is configured to fire when the metric drops to zero
    When the project sees no qualifying events for the trigger's window
    Then the heartbeat fires the alert within thirty seconds
    And the notification names the metric and the no-data condition

  Scenario: flag on, traffic stops while the alert is firing — resolve via heartbeat
    Given the project is on the event-sourced path
    And a graph alert is currently firing with an unresolved `TriggerSent`
    When the metric stays below the threshold and traffic stops
    Then the heartbeat resolves the alert within thirty seconds
    And the unresolved `TriggerSent` is marked resolved

  Scenario: rapid re-evaluation does not re-notify
    Given the project is on the event-sourced path
    And a graph alert is currently firing
    When the evaluator runs again within the debounce window
    Then no second notification is sent for the same incident
    And the `TriggerSent` count for the incident stays at one

  Scenario: flag flips mid-flight — no double-fire
    Given the project is on the event-sourced path
    And a graph alert has fired and the operator has been notified
    When the operator toggles the flag off mid-incident
    Then the cron does not re-fire the same incident
    And no second notification is sent
    And the alert resolves through whichever path catches the recovery

  Scenario: graph alert notification uses the alert-default template
    Given the project is on the event-sourced path
    And the trigger has no custom Liquid templates
    When the alert fires
    Then the notification subject reads as a metric-crossed-threshold alert
    And the notification body describes the graph and the breach
    And not the trace-iteration default used for trace-based triggers

  Scenario: graph alert custom template still overrides the alert default
    Given the project is on the event-sourced path
    And the operator has authored a custom email subject template for the trigger
    When the alert fires
    Then the notification subject renders the operator's template
    And the alert-default template is not used
