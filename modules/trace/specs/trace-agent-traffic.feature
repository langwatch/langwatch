Feature: Agents seen in a project's traffic

  Governance's agent registry registers every agent a project's spans name, so an agent that only
  sends traces or gateway calls is still listed (enterprise/modules/governance/specs/agent-registry.feature).
  The trace module answers that read from stored spans through TraceApi.findAgentsSeen.

  @unit
  Scenario: Distinct agent names are read from the project's spans in the window
    Given a project whose spans since the window start name agents "planner" and "researcher"
    When the agents seen since the window start are read
    Then the read asks stored spans for the project's tenant bounded by start time
    And it answers one row per agent name with its id, model, first and last seen time

  @unit
  Scenario: Spans outside the window or without an agent name are not counted
    Given a project with a span naming "planner" before the window and a span with no agent name
    When the agents seen since the window start are read
    Then no agent is answered

  @unit
  Scenario: The in-memory twin skips empty ids and models like the stored read
    Given a recorded span for "planner" with id "agent-7" and model "gpt-5"
    And a later span for "planner" with an empty id and model
    When the agents seen since the window start are read from the in-memory twin
    Then it answers "planner" with id "agent-7" and model "gpt-5"

  @integration
  Scenario: An agent seen with two models reads its latest model on every read
    Given a project whose spans for agent "planner" name model "gpt-5-mini" and later model "gpt-5"
    When the agents seen since the window start are read twice
    Then both reads answer "planner" with model "gpt-5" and its latest agent id
