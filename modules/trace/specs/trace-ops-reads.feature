Feature: Trace answers a staff investigation with counts and times, never content
  A staff agent's ops functions (ADR-202) ask trace whether traces arrived, whether the
  plan limit refused them and whether one trace id is stored. Every answer holds ids,
  counts and epoch-millisecond times only: no span names, attributes, input or output.

  @unit
  Scenario: A plan-limit refusal is counted for the project and the day
    Given a project whose organization is over its plan limit
    When an ingestion request asks the allowance
    Then the request is refused with the plan limit
    And the project's refusal count for that UTC day goes up by one

  @unit
  Scenario: A refusal that cannot be counted is still refused
    Given the refusal counter fails to write
    When an ingestion request over the plan limit asks the allowance
    Then the request is refused with the plan limit as before
    And the failed count is logged as a warning

  @integration
  Scenario: Refusals are summed per project over the days a range touches
    Given refusals recorded for two projects on several days
    When the refusals are counted over a range of days
    Then each project gets only its own refusals inside the range

  @integration
  Scenario: Ingestion is counted per asked project over a time range
    Given a project with traces inside and outside a range, and another project's traces
    When ingestion is counted for both projects and a third with no traces over the range
    Then each project gets its own trace count and latest trace time
    And the project with no traces gets zeros and no latest time

  @unit
  Scenario: Every asked project gets a row with its refusals, in the order asked
    Given traces and plan-limit refusals for some of the asked projects
    When ingestion is counted for the asked projects
    Then there is one row per asked project with its traces and refusals
    And an empty range counts nothing

  @integration
  Scenario: A stored trace's presence holds its span count and arrival times only
    Given a trace with spans stored in a project
    When its presence is asked in that project
    Then the answer names the trace, the project, the span count and the first and last arrival
    And asking for it in another project, or for an unknown id, answers nothing
