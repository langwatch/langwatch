@skills @testing @multi-assistant
Feature: Multi-assistant adapter support for skills testing
  As the LangWatch team
  We want to run skill scenario tests against multiple code assistants
  So that we verify skills work regardless of which assistant the user chooses

  Background:
    Given scenario tests live in skills/_tests/
    And each assistant has different conventions for skill directories and output formats
    And a factory selects the active runner based on the AGENT_UNDER_TEST environment variable

  # ──────────────────────────────────────────────────
  # R1: AgentRunner interface and types
  # ──────────────────────────────────────────────────

  @unit
  Scenario: AgentRunner interface declares capabilities
    Given the AgentRunner interface is defined
    Then it exposes a name identifying the assistant
    And it exposes capabilities including MCP support, skills directory, and config file
    And it exposes a createAgent method that accepts runner options and returns an AgentAdapter

  @unit
  Scenario: Runner capabilities describe what the assistant supports
    Given an AgentRunner with capabilities
    Then supportsMcp indicates whether the assistant can use MCP tools
    And skillsDirectory indicates where skills are placed in the working directory
    And configFile optionally indicates the assistant-specific config file name

  @unit
  Scenario: RunnerOptions specify how a test run is configured
    Given RunnerOptions are passed to createAgent
    Then workingDirectory specifies the temp directory for the test
    And skillPath optionally specifies which SKILL.md to copy
    And cleanEnv optionally strips API keys from the environment
    And skipMcp optionally disables MCP configuration

  # ──────────────────────────────────────────────────
  # R2: Claude Code runner
  # ──────────────────────────────────────────────────

  @integration
  Scenario: Claude Code runner preserves existing adapter behavior
    Given the Claude Code runner is extracted from the existing adapter
    When it creates an agent
    Then it spawns the claude binary with stream-json output format
    And it places skills in the .skills/ directory
    And it generates a CLAUDE.md pointing to the loaded skills
    And it configures the LangWatch MCP server when MCP is not skipped

  @integration
  Scenario: Claude Code runner declares full capabilities
    Given the Claude Code runner
    Then its name is "claude-code"
    And supportsMcp is true
    And skillsDirectory is ".skills"
    And configFile is "CLAUDE.md"

  @integration
  Scenario: Shared helpers remain available after extraction
    Given toolCallFix and assertSkillWasRead are moved to shared helpers
    Then existing tests that import from claude-code-adapter still work
    And new tests can import from the shared helpers directly

  # ──────────────────────────────────────────────────
  # R3: Codex runner
  # ──────────────────────────────────────────────────

  @integration
  Scenario: Codex runner invokes codex CLI correctly
    Given the Codex runner is available
    When it creates an agent
    Then it invokes "codex exec --full-auto --json" with the prompt
    And it parses JSONL output with event types
    And it places skills in the .agents/skills/ directory

  @integration
  Scenario: Codex runner has no MCP support
    Given the Codex runner
    Then its name is "codex"
    And supportsMcp is false
    And skillsDirectory is ".agents/skills"
    And configFile is not set

  @integration
  Scenario: Codex runner operates without MCP when tests request it
    Given a test does not skip MCP
    When the test runs against the Codex runner
    Then the runner silently operates without MCP
    And the test proceeds without error

  # ──────────────────────────────────────────────────
  # R4: Cursor CLI runner
  # ──────────────────────────────────────────────────

  @integration
  Scenario: Cursor runner places skills in the cursor directory
    Given the Cursor runner is available
    When it creates an agent
    Then it places skills in the .cursor/skills/ directory

  @integration
  Scenario: Cursor runner declares MCP support
    Given the Cursor runner
    Then its name is "cursor"
    And supportsMcp is true
    And skillsDirectory is ".cursor/skills"

  @integration
  Scenario: Cursor runner stubs gracefully when CLI is unavailable
    Given the cursor binary is not installed
    When a test attempts to create a Cursor agent
    Then the test is skipped with a message indicating the CLI is unavailable

  # ──────────────────────────────────────────────────
  # R5: Agent factory with environment variable selection
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Factory defaults to Claude Code when no environment variable is set
    Given AGENT_UNDER_TEST is not set
    When createAgent is called
    Then it delegates to the Claude Code runner

  @unit
  Scenario: Factory selects the runner matching the environment variable
    Given AGENT_UNDER_TEST is set to "codex"
    When createAgent is called
    Then it delegates to the Codex runner

  @unit
  Scenario: Factory rejects unknown assistant names
    Given AGENT_UNDER_TEST is set to "unknown-assistant"
    When createAgent is called
    Then it throws an error identifying the unknown agent

  @unit
  Scenario: Test files use createAgent instead of createClaudeCodeAgent
    Given tests import createAgent from the agent factory
    When they run without AGENT_UNDER_TEST set
    Then behavior is identical to the previous createClaudeCodeAgent import

  # ──────────────────────────────────────────────────
  # R6: Skill placement abstraction
  # ──────────────────────────────────────────────────

  @integration
  Scenario: Runner places skills in the correct directory for Claude Code
    Given the Claude Code runner is active
    When a test passes a skillPath option
    Then the skill is placed at .skills/<name>/SKILL.md in the working directory
    And a CLAUDE.md is generated referencing the skill

  @integration
  Scenario: Runner places skills in the correct directory for Codex
    Given the Codex runner is active
    When a test passes a skillPath option
    Then the skill is placed at .agents/skills/<name>/SKILL.md in the working directory
    And no additional config file is generated

  @integration
  Scenario: Runner places skills in the correct directory for Cursor
    Given the Cursor runner is active
    When a test passes a skillPath option
    Then the skill is placed at .cursor/skills/<name>/SKILL.md in the working directory

  @integration
  Scenario: Tests do not hardcode skill directory paths
    Given a test passes skillPath in RunnerOptions
    Then the runner handles placement internally
    And the test does not reference .skills/, .agents/skills/, or .cursor/skills/ directly

  # ──────────────────────────────────────────────────
  # R7: Test runner scripts
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Package.json includes per-assistant test scripts
    Given the skills/_tests/package.json
    Then it includes a "test:claude" script that sets AGENT_UNDER_TEST=claude-code
    And it includes a "test:codex" script that sets AGENT_UNDER_TEST=codex
    And it includes a "test:cursor" script that sets AGENT_UNDER_TEST=cursor
    And it includes a "test:all-agents" script that runs all three sequentially

  @unit
  Scenario: Per-assistant scripts exclude static validation tests
    Given the "test:claude" script
    Then it excludes static-validation.test.ts from the run
    And the same exclusion applies to test:codex and test:cursor

  @unit
  Scenario: Default test script remains backward compatible
    Given the "test" script in package.json
    Then it runs vitest without setting AGENT_UNDER_TEST
    And this defaults to Claude Code via the factory

  # ──────────────────────────────────────────────────
  # R8: Capability-aware test skipping
  # ──────────────────────────────────────────────────

  @integration
  Scenario: MCP-dependent tests skip on assistants without MCP support
    Given a test requires MCP tools to create evaluators
    When the test runs against the Codex runner
    Then the test is skipped because Codex does not support MCP

  @integration
  Scenario: MCP-dependent tests run on assistants with MCP support
    Given a test requires MCP tools to create evaluators
    When the test runs against the Claude Code runner
    Then the test executes normally

  @integration
  Scenario: Tests use runner capabilities for skip conditions
    Given a test uses skipIf with the runner's supportsMcp capability
    Then the skip condition adapts automatically to the active runner
    And the test file does not contain assistant-specific skip logic
