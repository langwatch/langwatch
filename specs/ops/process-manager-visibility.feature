# Plan: dev/docs/ops-process-manager-visibility-plan.md — nothing here is
# built yet. Every scenario is @unimplemented on purpose: this file marks the
# contract the plan proposes, and each scenario graduates to a binding tag
# (@unit/@integration) as its slice lands.

Feature: Process-manager visibility in ops
  As an operator during an incident
  I want the process-manager substrate to have an ops surface
  So that a dead intent or a starved wake is seen before a customer reports its symptom

  Context: eight pipelines run durable processes through the ADR-049
  substrate, and none of it is visible under /ops. A dead outbox message is
  an effect that silently never happened; an overdue wake is a process
  frozen mid-flow; today both are found with psql or not at all.

  Background:
    Given an operator is viewing the processes page

  # ── Read-only surface (phase 1) ───────────────────────────────────────

  @unimplemented
  Scenario: Each process name reports its trouble counts on one row
    Given processes with pending, lapsed, and dead outbox messages
    When the processes table renders
    Then each process name shows instance, overdue-wake, pending, lapsed, and dead counts
    And rows with trouble sort above healthy ones

  @unimplemented
  Scenario: Dead intents are impossible to miss
    Given a process name with dead outbox messages
    When the page renders
    Then the dead count is presented as a failure demanding action
    And it links to the messages themselves

  @unimplemented
  Scenario: A lapsed lease does not accuse a live dispatcher
    Given a pending message whose lease expired
    When it is listed
    Then it reads as "dispatcher died or still delivering", not as a confirmed death

  @unimplemented
  Scenario: An instance drawer answers what the process is doing
    Given an operator opens one process instance
    When the drawer renders
    Then it shows the state structurally with JSON on demand
    And its outbox messages with status, attempts, and next attempt
    And each message links to its producing trace via its stored carrier

  @unimplemented
  Scenario: Overdue wakes are surfaced with their age
    Given instances whose next wake is long past due
    When the page renders
    Then each is listed with how long overdue the wake is

  # ── Actions (phase 2) ─────────────────────────────────────────────────

  @unimplemented
  Scenario: An operator wakes a stuck process now
    Given an instance with an overdue wake
    When the operator confirms the wake-now action
    Then the instance's next wake is set to now
    And the action lands in the ops audit trail

  @unimplemented
  Scenario: A dead message is redriven, idempotently
    Given a dead outbox message
    When the operator confirms the redrive
    Then it returns to pending with an immediate next attempt
    And a duplicate delivery is absorbed by the message key
