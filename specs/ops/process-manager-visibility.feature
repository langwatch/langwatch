# Plan: dev/docs/ops-process-manager-visibility-plan.md. Phase 1 (read-only
# fleet + instance drawer) and the phase-2 safe actions are built; the
# remaining @unimplemented scenarios are phase 3 (signals/alerting).

Feature: Process-manager visibility in ops
  As an operator during an incident
  I want the process-manager substrate to have an ops surface
  So that a dead intent or a starved wake is seen before a customer reports its symptom

  Context: eight pipelines run durable processes through the ADR-049
  substrate, and none of it was visible under /ops. A dead outbox message is
  an effect that silently never happened; an overdue wake is a process
  frozen mid-flow; both were found with psql or not at all.

  Background:
    Given an operator is viewing the processes page

  # ── Read-only surface ─────────────────────────────────────────────────

  @unit
  Scenario: Each process name reports its trouble counts on one row
    Given processes with pending, lapsed, and dead outbox messages
    When the fleet is summarized
    Then each process name carries instance, overdue-wake, pending, lapsed, and dead counts
    And names with trouble sort above healthy ones

  @unit
  Scenario: Dead intents are impossible to miss
    Given a process name with dead outbox messages
    When the fleet table renders
    Then the dead count is presented as a failure
    And the row leads to the instances that hold them

  @unit
  Scenario: A lapsed lease does not accuse a live dispatcher
    Given a pending message whose lease expired
    When its card renders
    Then it reads as dispatcher died or still delivering, not as a confirmed death

  @unit
  Scenario: An instance drawer answers what the process is doing
    Given an operator opens one process instance
    When the drawer renders
    Then it shows the state as JSON alongside revision and next wake
    And its outbox messages with intent type, status, attempts, and next attempt
    And a message with a stored carrier links to its producing trace

  @unit
  Scenario: Overdue wakes are surfaced with their age
    Given an instance whose next wake is long past due
    When its wake is described
    Then it reads as due with how long ago, never as a bare countdown

  # ── Actions ───────────────────────────────────────────────────────────

  @integration
  Scenario: An operator wakes a stuck process now
    Given an instance with a far-future wake
    When the operator triggers wake now
    Then the instance's next wake is now
    And the action lands in the audit trail with the previous wake time

  @integration
  Scenario: A dead message is redriven, once
    Given a dead outbox message
    When the operator redrives it
    Then it returns to pending with an immediate next attempt and a fresh budget
    And redriving it again is a no-op
    And the redrive lands in the audit trail

  # ── Signals ───────────────────────────────────────────────────────────

  @unit
  Scenario: The fleet's trouble counts reach Prometheus
    Given dead messages and overdue wakes exist
    When the metrics endpoint is scraped
    Then gauges report dead messages and overdue wakes per process name
    And each gauge states it must be aggregated with max across pods

  @unit
  Scenario: An operator releases a lapsed lease knowingly
    Given a pending message whose lease expired
    When the operator releases the lease
    Then the message becomes due immediately
    And a live lease cannot be released from under its delivery
