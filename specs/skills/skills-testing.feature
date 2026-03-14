@skills @testing
Feature: Scenario tests for skills quality assurance
  As the LangWatch team
  We want every skill to have scenario tests proving it works
  So that we can compound improvements with confidence and catch regressions

  Background:
    Given scenario tests live in skills/_tests/
    And fixture codebases live in skills/_tests/fixtures/
    And tests run against production LangWatch
    And tests use Claude Code as the agent under test

  # ──────────────────────────────────────────────────
  # Test infrastructure
  # ──────────────────────────────────────────────────

  Scenario: Claude Code agent adapter exists for skill testing
    Given a reusable Claude Code agent adapter exists in skills/_tests/
    Then it spawns Claude Code with the skill loaded
    And it configures the LangWatch MCP with a test API key
    And it runs in a temporary directory with the fixture codebase
    And it captures Claude Code's output for assertion

  Scenario: Fixture codebases cover the framework matrix
    Given fixture codebases exist for the key combinations:
      | language   | framework    | fixture_name              |
      | python     | openai       | python-openai             |
      | python     | langgraph    | python-langgraph          |
      | python     | agno         | python-agno               |
      | python     | litellm      | python-litellm            |
      | typescript | vercel-ai    | typescript-vercel          |
      | typescript | mastra       | typescript-mastra          |
    Then each fixture contains a minimal agent implementation
    And each fixture has no LangWatch instrumentation

  # ──────────────────────────────────────────────────
  # Instrument skill tests
  # ──────────────────────────────────────────────────

  @instrument @integration
  Scenario: Instrument skill works for Python + OpenAI
    Given the fixture "python-openai" is copied to a temp directory
    And the skill "instrument" is loaded
    When Claude Code receives "instrument my code with LangWatch"
    Then the agent modifies the Python file to add LangWatch tracing
    And the file contains "@langwatch.trace()" or "langwatch.trace()" decorator
    And the file contains "autotrack_openai_calls" or equivalent
    And the agent used the LangWatch MCP to read documentation

  @instrument @integration
  Scenario: Instrument skill works for TypeScript + Vercel AI
    Given the fixture "typescript-vercel" is copied to a temp directory
    And the skill "instrument" is loaded
    When Claude Code receives "instrument my code with LangWatch"
    Then the agent modifies the TypeScript file to add LangWatch tracing
    And the file imports from "langwatch"
    And the agent used the LangWatch MCP to read documentation

  @instrument @integration
  Scenario: Instrument skill works for Python + LangGraph
    Given the fixture "python-langgraph" is copied to a temp directory
    And the skill "instrument" is loaded
    When Claude Code receives "instrument my code with LangWatch"
    Then the agent modifies the Python file to add LangWatch tracing
    And the agent used the LangWatch MCP to read LangGraph integration docs

  # ──────────────────────────────────────────────────
  # Experiment skill tests
  # ──────────────────────────────────────────────────

  @experiment @integration
  Scenario: Experiment skill creates a Jupyter notebook for Python
    Given the fixture "python-openai" is copied to a temp directory
    And the skill "experiment" is loaded
    When Claude Code receives "create an evaluation experiment for my agent"
    Then the agent creates a Jupyter notebook (.ipynb) file
    And the notebook imports langwatch
    And the notebook uses langwatch.experiment.init()
    And the agent generates a dataset tailored to the fixture's domain
    And the notebook includes at least one evaluator

  @experiment @integration
  Scenario: Experiment skill creates a script for TypeScript
    Given the fixture "typescript-vercel" is copied to a temp directory
    And the skill "experiment" is loaded
    When Claude Code receives "create an evaluation experiment for my agent"
    Then the agent creates a TypeScript script file
    And the script imports from "langwatch"
    And the script uses langwatch.experiments.init()

  # ──────────────────────────────────────────────────
  # Scenario-test skill tests
  # ──────────────────────────────────────────────────

  @scenario-test @integration
  Scenario: Scenario-test skill creates tests without hallucinating a framework
    Given the fixture "python-openai" is copied to a temp directory
    And the skill "scenario-test" is loaded
    When Claude Code receives "add agent simulation tests for my agent"
    Then the agent creates scenario test files using @langwatch/scenario or langwatch-scenario
    And the test files import from the real scenario package
    And the agent did NOT invent its own testing framework
    And the agent used the LangWatch MCP to read Scenario docs

  @scenario-test @integration
  Scenario: Scenario-test skill creates TypeScript tests with vitest
    Given the fixture "typescript-vercel" is copied to a temp directory
    And the skill "scenario-test" is loaded
    When Claude Code receives "add agent simulation tests for my agent"
    Then the agent creates a .test.ts file
    And the file imports from "@langwatch/scenario"
    And the file uses vitest (describe, it, expect)

  # ──────────────────────────────────────────────────
  # Prompt-versioning skill tests
  # ──────────────────────────────────────────────────

  @prompt-versioning @integration
  Scenario: Prompt-versioning skill uses CLI, not hardcoded prompts
    Given the fixture "python-openai" is copied to a temp directory
    And the skill "prompt-versioning" is loaded
    When Claude Code receives "version my agent prompts"
    Then the agent runs "langwatch prompt init"
    And the agent runs "langwatch prompt create" for each prompt
    And a prompts.json file exists
    And prompt YAML files exist in the prompts/ directory
    And the agent updates application code to use langwatch.prompts.get()
    And the agent does NOT duplicate prompt text as a fallback

  # ──────────────────────────────────────────────────
  # Level-up meta-skill tests
  # ──────────────────────────────────────────────────

  @level-up @integration
  Scenario: Level-up skill orchestrates all sub-skills for Python
    Given the fixture "python-openai" is copied to a temp directory
    And the skill "level-up" is loaded
    When Claude Code receives "take my agent to the next level"
    Then the agent instruments the code with LangWatch tracing
    And the agent sets up prompt versioning
    And the agent creates an evaluation experiment
    And the agent creates scenario tests
    And each step verifies its output before proceeding

  @level-up @integration
  Scenario: Level-up skill orchestrates all sub-skills for TypeScript
    Given the fixture "typescript-vercel" is copied to a temp directory
    And the skill "level-up" is loaded
    When Claude Code receives "take my agent to the next level"
    Then the agent instruments the code with LangWatch tracing
    And the agent sets up prompt versioning
    And the agent creates an evaluation experiment
    And the agent creates scenario tests

  # ──────────────────────────────────────────────────
  # Red-team skill tests
  # ──────────────────────────────────────────────────

  @red-team @integration
  Scenario: Red-team skill creates adversarial tests for Python
    Given the fixture "python-openai" is copied to a temp directory
    And the skill "red-team" is loaded
    When Claude Code receives "red team my agent for vulnerabilities"
    Then the agent creates scenario test files using RedTeamAgent
    And the agent used the LangWatch MCP to read Scenario red teaming docs

  @red-team @integration
  Scenario: Red-team skill creates adversarial tests for TypeScript
    Given the fixture "typescript-vercel" is copied to a temp directory
    And the skill "red-team" is loaded
    When Claude Code receives "red team my agent for vulnerabilities"
    Then the agent creates scenario test files using RedTeamAgent

  # ──────────────────────────────────────────────────
  # Platform skill tests (no codebase — simulating claude web)
  # ──────────────────────────────────────────────────

  @platform @analytics @integration
  Scenario: Analytics skill uses MCP to query performance
    Given an empty temporary directory (no codebase)
    And the skill "analytics" is loaded
    And the LangWatch MCP is configured with an API key
    When the agent receives "tell me how my agent has been performing"
    Then the agent uses discover_schema to learn available metrics
    And the agent uses get_analytics or search_traces to query data
    And the agent provides a summary of performance trends

  @platform @platform-scenario @integration
  Scenario: Platform-scenario skill creates scenarios via platform tools
    Given an empty temporary directory (no codebase)
    And the skill "platform-scenario" is loaded
    And the LangWatch MCP is configured with an API key
    When the agent receives "write scenario simulation tests for my agent"
    Then the agent uses platform_create_scenario to create scenarios
    And the agent does NOT try to write code files
