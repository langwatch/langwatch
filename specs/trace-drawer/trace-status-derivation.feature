Feature: Trace status derivation from projected summary
  As a platform engineer
  I want the trace status pill / row tint to reflect the trace's real outcome
  So that the dashboard reads truthfully when SDK instrumentation
  doesn't go out of its way to bump OpenTelemetry StatusCode to OK on success.

  Background:
    OpenTelemetry's StatusCode defaults to UNSET. Most SDK
    instrumentation (LangChain, LangGraph, Genkit, Mastra, direct
    provider clients) never upgrades it to OK on success - it only
    flips to ERROR on failure. A prior derivation treated "no OK seen"
    as "warning"; on 2026-05-20 that was firing for 118k of every 327k
    traces in a 7-day prod sweep, drowning every customer's table in
    yellow chips for plain successful runs. The fix collapses the
    derivation to three deterministic branches.

  @unit
  Scenario: Trace status defaults to ok when OTel StatusCode is UNSET on every span
    Given a trace whose projected summary has containsErrorStatus=false
    And the summary has blockedByGuardrail=false
    And no span on the trace ever reported an OTel OK status
    When the trace status is derived for the table row and drawer header
    Then the derived status is "ok"

  @unit
  Scenario: Trace status is error when any span reports OTel ERROR
    Given a trace whose projected summary has containsErrorStatus=true
    When the trace status is derived
    Then the derived status is "error"
    And it stays "error" even when the trace was also blockedByGuardrail

  @unit
  Scenario: Trace status is warning when the trace ran but was guardrail-blocked
    Given a trace whose projected summary has containsErrorStatus=false
    And the summary has blockedByGuardrail=true
    When the trace status is derived
    Then the derived status is "warning"
