Feature: Per-criterion judge verdicts on scenario runs
  The scenario judge settles every criterion on its own: a status (passed,
  failed or inconclusive), the criterion restated as a positive requirement,
  and its own reasoning. An inconclusive criterion means the evidence to decide
  it was missing, so the run view tells "the test could not check this" apart
  from "the agent failed". The run verdict stays binary: a run passes only when
  every criterion passed. SDKs from before per-criterion verdicts send only the
  met, unmet and inconclusive lists; the platform derives the per-criterion
  view from them with empty reasoning.
  The SDKs send it as `results.criteria` on the run finished event, next to
  the lists older consumers read.

  @unit
  Scenario: The events endpoint keeps inconclusive criteria and per-criterion verdicts
    Given a run finished event whose results name an inconclusive criterion and carry per-criterion verdicts
    When the scenario library posts it to the events endpoint
    Then the finished run command carries the inconclusive criteria
    And it carries each criterion with its status, requirement and reasoning

  @unit
  Scenario: A finished event with per-criterion verdicts is folded into the run
    Given a finished event carrying per-criterion verdicts
    When the event is folded into the run
    Then the run holds each criterion with its status, requirement and reasoning in declared order

  @unit
  Scenario: Inconclusive criteria are taken from the per-criterion verdicts when the list is absent
    Given a finished event whose per-criterion verdicts mark one criterion inconclusive
    And the event names no inconclusive criteria list
    When the event is folded into the run
    Then that criterion is listed among the inconclusive criteria

  @integration
  Scenario: Per-criterion verdicts survive the run row
    Given a finished run stored with per-criterion verdicts
    When the run is read back
    Then each criterion reads back with its status, requirement and reasoning
    And a row written before the columns existed reads back with none

  @unit
  Scenario: A run from an older SDK reads back with derived per-criterion results
    Given a stored run with met, unmet and inconclusive criteria lists and no per-criterion verdicts
    When the run is read
    Then each met criterion reads as passed, each inconclusive one as inconclusive and every other unmet one as failed
    And every derived criterion carries an empty reasoning

  @unit
  Scenario: A criterion the per-criterion verdicts miss is derived from the lists
    Given a run whose per-criterion verdicts cover only some of its listed criteria
    When its per-criterion results are resolved
    Then the stored verdicts come first and every missing criterion is derived from the lists

  @unit
  Scenario: The simulation runs API returns per-criterion results
    Given a finished run with per-criterion verdicts
    When it is read through the simulation runs REST API
    Then the response carries the inconclusive criteria and each criterion with its status and reasoning

  @integration
  Scenario: The run view shows each criterion with its own status and reasoning
    Given a finished run with per-criterion verdicts
    When the run view opens
    Then each criterion shows under its status with the judge's reasoning for it
    And the requirement the judge checked shows when it differs from the criterion

  @integration
  Scenario: A criterion the test could not check reads apart from a failed one
    Given a finished run with one failed criterion and one inconclusive criterion
    When the run view opens
    Then the inconclusive criterion shows under "Could not check" with the missing evidence
    And it does not show among the failed criteria
    And the run verdict still reads FAILED

  @integration
  Scenario: The criteria chip counts a criterion the test could not check apart
    Given a finished run with one inconclusive criterion
    When the criteria chip's details open
    Then the inconclusive criterion is listed under "Could not check", not under "Unmet"
