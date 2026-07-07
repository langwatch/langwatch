@skills @integration
Feature: Split LangWatch evaluation skills by intent
  As a LangWatch skills user
  I want separate skills for online evaluations and experiments
  So that my agent chooses the right workflow for production monitoring versus batch testing

  Scenario: Online evaluations skill handles production monitoring and guardrails
    Given the skill "evaluations" is loaded
    When the user asks to monitor production quality or add guardrails
    Then the agent sets up online evaluation monitors or guardrails
    And the agent does not create a batch experiment unless the user asks for pre-production testing

  Scenario: Experiments skill handles batch testing
    Given the skill "experiments" is loaded
    When the user asks to test, benchmark, compare models, or add CI quality gates
    Then the agent creates a LangWatch experiment with a domain-specific dataset
    And the agent runs the experiment for real
    And the agent does not configure production monitors unless the user asks for monitoring

  Scenario: Skills cross-reference each other when the user means the other workflow
    Given either the "evaluations" or "experiments" skill is loaded
    When the user's wording matches the other workflow
    Then the loaded skill tells an installed agent to load and follow the other skill
    And if the other skill is not installed it tells the user to install it
    And it summarizes the distinction between online evaluations and experiments

  Scenario: Scenario tests validate each split skill with real credentials
    Given the skills scenario test suite is run outside CI with credentials loaded from skills/.env
    Then online evaluation scenarios use the "evaluations" skill
    And batch experiment scenarios use the "experiments" skill
    And both test files assert the agent read the intended split skill
