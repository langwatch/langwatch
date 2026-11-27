Feature: Activity ops functions
  A staff session reads what an organization did with coding agents, the gateway, Instant Evals
  and scenarios as counts per day or week, each through the owning module. Outputs carry ids,
  counts, codes and times only: no names, no prompts, no content. ADR-202, amendment 2026-11-25.

  Background:
    Given cloud ops is on and the system flag "ops_agent_access_enabled" is on
    And Olivia holds the platform-operator grant and has a passkey
    And the organization "ACME" exists with a project "acme-support"

  @unit
  Scenario: A stored agent kind or failure code leaves as one plain word or as other
    Given a stored code "provider_rate_limited" and a stored code "Timeout after 30s: ACME prompt"
    When they are collapsed for an ops function output
    Then the first stays "provider_rate_limited" and the second reads "other"

  @unit
  Scenario: Weeks are UTC Monday weeks counted back from the current one
    Given it is Thursday 2026-11-05 in UTC
    When the last 3 weeks are asked for
    Then they start on Monday 2026-10-19, 2026-10-26 and 2026-11-02

  @integration
  Scenario: org.coding_agents answers sessions per day, project and agent
    Given ACME's project ran coding agent sessions over the last days
    When the agent calls "org.coding_agents" for the last 7 days
    Then each row carries the day, the project id, the agent, the session count and the user count
    And an agent kind that is not a plain word reads "other"
    And no session title, branch or user id

  @unit
  Scenario: org.coding_agents keeps two agent kinds that both read as other in their own rows
    Given ACME's project ran two agent kinds that are not plain words on the same day
    When the agent calls "org.coding_agents"
    Then each kind is its own "other" row with its own session and user counts, never summed

  @integration
  Scenario: org.coding_agents reads only the approved organization's projects
    Given a redeemed "org:metadata" session on ACME naming "org.coding_agents"
    When the agent calls "org.coding_agents"
    Then the coding agent read names only ACME's project ids

  @integration
  Scenario: org.gateway_spend answers requests and spend per day, virtual key and provider
    Given ACME's gateway served requests over the last days
    When the agent calls "org.gateway_spend" for the last 7 days
    Then each row carries the day, the project id, the virtual key id, the provider id, the requests, the failed requests and the spend in USD
    And no model prompt, response or key secret

  @integration
  Scenario: org.instant_evals answers runs per week with rows judged, failures by code and price
    Given ACME's project ran Instant Evals on two days of one week, one of them failing
    When the agent calls "org.instant_evals" for the last 14 days
    Then the week carries the run count, the rows judged, the largest run, the failures by code, the price and the last run time
    And no statement, question or judged text

  @integration
  Scenario: org.activity_weekly answers one row per week
    Given ACME had traces, evaluations, Instant Evals, scenario runs, coding agent sessions and gateway requests
    When the agent calls "org.activity_weekly" for 4 weeks
    Then it answers 4 weeks, oldest first, each with those counts and the members active since the week began

  @unit
  Scenario: org.activity_weekly reads its daily figures in spans within the range limit
    Given a redeemed "org:metadata" session on ACME naming "org.activity_weekly"
    When the agent calls it for 9 weeks
    Then it answers 9 weeks, and no coding agent, gateway or Instant Eval read spans more than 31 days

  @integration
  Scenario: org.activity_weekly reads at most 26 weeks
    Given a redeemed "org:metadata" session on ACME naming "org.activity_weekly"
    When the agent calls it for 27 weeks, or for 0
    Then it is refused 422 with "staff_function_bad_input"

  @integration
  Scenario: scenarios.runs_by_org answers organizations that ran scenarios, by id and plan
    Given ACME ran scenarios in the range and Globex ran none
    And a redeemed "ops:read" session naming "scenarios.runs_by_org"
    When the agent calls "scenarios.runs_by_org" for the last 7 days
    Then it answers ACME's id, its plan, its projects, suites, runs and failed runs
    And Globex is not listed
    And no organization name

  @integration
  Scenario: scenarios.runs_by_org needs an ops:read session
    Given Olivia enrolled "laptop agent"
    When the agent asks for "org:metadata" on ACME naming "scenarios.runs_by_org"
    Then it is refused 422 with "staff_function_scope_mismatch"

  @integration
  Scenario: Coding agent sessions per day count a refolded session once
    Given a coding agent session folded twice and a session outside the window
    When the coding agent module counts sessions per day for the window
    Then the refolded session counts once, with its user, and the other is left out

  @integration
  Scenario: Gateway spend per day counts each request once at its latest status
    Given a gateway request admitted and then failed, and one confirmed on another key
    When the gateway module counts requests per day, virtual key and provider
    Then each request counts once, the failed one as failed, at its latest cost

  @integration
  Scenario: Instant Eval runs per day carry failures by code at their latest version
    Given an Instant Eval run that finished and one that failed with a code
    When the Instant Eval module counts runs per day
    Then the day carries both runs, the rows judged and the failure under its code

  @integration
  Scenario: Scenario runs per project count each run once at its latest version
    Given a scenario run written twice, finishing as failed, and runs in two projects
    When the scenario module counts runs per project for the window
    Then each run counts once, failures by their latest status, suites by scenario set

  @integration
  Scenario: An activity range is at most 31 days
    Given a redeemed "org:metadata" session on ACME naming "org.gateway_spend"
    When the agent calls it with a range of 40 days
    Then it is refused 422 with "staff_function_bad_input"
