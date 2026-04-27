Feature: Per-role cost and latency accumulation from trace spans

  Background:
    Costs live on child LLM spans, while the langwatch.scenario.role attribute
    lives on parent agent spans. The fold must walk the parent chain to attribute
    LLM costs to the correct role.

  Scenario: Agent span with child LLM calls
    Given a trace with an agent span tagged role "Agent"
    And the agent span has 2 child LLM spans costing $0.001 and $0.002
    Then traceSummary.roleCosts["Agent"] equals $0.003
    And traceSummary.roleLatencies["Agent"] equals the agent span duration

  Scenario: Multiple roles in one trace
    Given a trace with User, Agent, and Judge role spans
    And each has child LLM spans with different costs
    Then roleCosts has separate entries for "User", "Agent", and "Judge"
    And each entry sums only its descendants' costs

  Scenario: Deeply nested spans inherit role
    Given an agent span with role "Agent"
    And a tool span child of the agent span
    And an LLM span child of the tool span costing $0.005
    Then roleCosts["Agent"] includes the $0.005 from the nested LLM span

  Scenario: Trace without scenario roles
    Given a regular trace with no langwatch.scenario.role attributes
    Then roleCosts and roleLatencies remain empty
