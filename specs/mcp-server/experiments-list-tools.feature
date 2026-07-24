@integration
Feature: MCP tools for listing experiments and evaluation runs
  As an LLM agent connected to the LangWatch MCP server
  I want `platform_experiment_list` and `platform_experiment_list_runs` tools
  So that I can discover experiment slugs and run ids before drilling into results

  Background:
    Given an MCP server configured with a valid LANGWATCH_API_KEY

  # ==========================================================================
  # platform_experiment_list
  # ==========================================================================

  Scenario: Lists experiments as markdown
    Given the project owns experiments "checkout-flow" and "support-bot"
    When the agent invokes platform_experiment_list with no arguments
    Then the response is markdown
    And the response lists each experiment slug
    And the response includes the count of runs per experiment when known

  @unimplemented
  Scenario: Limit caps the number of experiments returned
    Given the project owns 60 experiments
    When the agent invokes platform_experiment_list with limit 10
    Then the response includes at most 10 experiments
    And the response notes that results were truncated

  Scenario: Limit is bounded to protect agent context
    When the agent invokes platform_experiment_list with limit 5000
    Then the call fails with a validation error mentioning the maximum limit of 100

  # ==========================================================================
  # platform_experiment_list_runs
  # ==========================================================================

  @unimplemented
  Scenario: Listing runs requires experimentSlug
    When the agent invokes platform_experiment_list_runs without experimentSlug
    Then the call fails with a validation error mentioning "experimentSlug"

  Scenario: Lists runs for a known experiment
    Given the experiment "checkout-flow" has 2 completed runs
    When the agent invokes platform_experiment_list_runs with experimentSlug "checkout-flow"
    Then the response is markdown
    And the response lists each run id
    And each row reports status and started/finished timestamps

  Scenario: Unknown experiment slug returns a graceful not-found message
    When the agent invokes platform_experiment_list_runs with experimentSlug "does-not-exist"
    Then the response indicates the experiment was not found
    And the response suggests calling platform_experiment_list to discover slugs
