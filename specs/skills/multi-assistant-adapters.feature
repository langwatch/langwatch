@skills @testing @infrastructure
Feature: Multi-assistant adapters for skill scenario tests
  As the LangWatch team
  We want the same scenario tests to run against Claude Code, Codex, and Cursor
  So that we can verify skills work across multiple code assistants without duplicating test files

  Background:
    Given scenario tests live in skills/_tests/
    And a test uses createAgent() to obtain an AgentAdapter
    And the active runner is selected via the AGENT_UNDER_TEST environment variable

  # ──────────────────────────────────────────────────
  # R1: AgentRunner interface and types
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Runner exposes name and MCP capability flag
    Given a runner implementing the AgentRunner interface
    Then it exposes a name identifying the assistant
    And it exposes capabilities declaring MCP support, skills directory, and config file
    And it provides a createAgent method that returns an AgentAdapter

  @unit
  Scenario: Capabilities accurately reflect assistant limitations
    Given each runner declares its capabilities at construction time
    Then the Claude Code runner declares MCP support as true
    And the Codex runner declares MCP support as false
    And the Cursor runner declares MCP support as true
    And each runner declares the correct skills directory for its assistant

  # ──────────────────────────────────────────────────
  # R2: Claude Code runner extraction
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Claude Code runner constructs correct CLI arguments
    Given the Claude Code runner is configured
    When it builds the spawn arguments
    Then the args include --output-format stream-json
    And the args include -p for prompt mode
    And the args include --dangerously-skip-permissions and --verbose

  @unit
  Scenario: Claude Code runner generates MCP config when not skipped
    Given the Claude Code runner is configured with skipMcp as false
    When createAgent is called
    Then a .mcp-config.json file is written to the working directory
    And the config points to the LangWatch MCP server

  @unit
  Scenario: Claude Code runner normalizes stream-json output
    Given Claude Code produces stream-json NDJSON with tool_use content blocks
    When the runner parses the output
    Then it normalizes tool_use blocks to text blocks for SDK compatibility

  @integration
  Scenario: Claude Code runner spawns binary and produces AgentAdapter response
    Given the Claude Code runner is extracted from claude-code-adapter.ts
    When a test creates an agent via the Claude Code runner
    Then it spawns the claude binary successfully
    And the returned response is compatible with @langwatch/scenario

  @integration
  Scenario: Legacy import paths resolve to new module locations
    Given existing test files import from claude-code-adapter.ts
    When the module is loaded
    Then all previously exported symbols are still available
    And they delegate to the new runner and shared utility locations

  # ──────────────────────────────────────────────────
  # R3: Codex runner
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Codex runner constructs correct CLI arguments
    Given the Codex runner is configured
    When it builds the spawn arguments
    Then the args include exec --full-auto --json flags

  @unit
  Scenario: Codex runner parses JSONL output from fixture data
    Given a JSONL fixture containing thread.started, item.completed, and turn.completed events
    When the Codex output parser processes the fixture
    Then it extracts the assistant message content from item.completed events
    And it ignores non-message events

  @unit
  Scenario: Codex runner normalizes output for SDK compatibility
    Given Codex produces JSONL with its own content block structure
    When the runner parses the output
    Then it normalizes content into the format expected by @langwatch/scenario

  @unit
  Scenario: Codex runner places skills in the agents directory
    Given the Codex runner handles skill placement
    When a skill is provided via skillPath in RunnerOptions
    Then the skill file is copied to .agents/skills/<name>/SKILL.md

  @unit
  Scenario: Codex runner operates without MCP silently
    Given the Codex runner does not support MCP
    When a test requests MCP configuration
    Then the runner proceeds without error
    And no MCP config file is written to the working directory

  @integration
  Scenario: Codex runner spawns binary and produces AgentAdapter response
    Given the Codex runner is configured
    And the codex binary is available on the system path
    When a test creates an agent via the Codex runner
    Then it spawns the codex binary successfully
    And the returned response is compatible with @langwatch/scenario

  # ──────────────────────────────────────────────────
  # R3b: Cursor runner
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Cursor runner constructs correct CLI arguments
    Given the Cursor runner is configured
    When it builds the spawn arguments
    Then the args include -p for non-interactive print mode
    And the args include --output-format stream-json
    And the args include --force and --trust
    And the args include --approve-mcps when MCP is configured
    And the args include --workspace pointing to the working directory

  @unit
  Scenario: Cursor runner parses stream-json output
    Given Cursor produces stream-json NDJSON output
    When the runner parses the output
    Then it extracts message objects from the NDJSON lines

  @unit
  Scenario: Cursor runner places skills in .cursor/rules directory
    Given the Cursor runner handles skill placement
    When a skill is provided via skillPath in RunnerOptions
    Then the skill file is copied to .cursor/rules/<name>/SKILL.md

  @unit
  Scenario: Cursor runner writes MCP config to .cursor/mcp.json
    Given the Cursor runner supports MCP
    And skipMcp is false
    When createAgent is called
    Then a .cursor/mcp.json file is written in the working directory
    And the config points to the LangWatch MCP server

  @unit
  Scenario: Cursor runner skips MCP config when skipMcp is true
    Given the Cursor runner supports MCP
    And skipMcp is true
    When createAgent is called
    Then no .cursor/mcp.json file is written

  @integration
  Scenario: Cursor runner spawns binary and produces AgentAdapter response
    Given the Cursor runner is configured
    And the cursor-agent binary is available on the system path
    When a test creates an agent via the Cursor runner
    Then it spawns the cursor-agent binary successfully
    And the returned response is compatible with @langwatch/scenario

  # ──────────────────────────────────────────────────
  # R4: Agent factory and environment variable selection
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Factory defaults to Claude Code when no env var is set
    Given AGENT_UNDER_TEST is not set
    When createAgent is called
    Then the factory selects the Claude Code runner

  @unit
  Scenario: Factory selects the runner matching the env var
    Given AGENT_UNDER_TEST is set to "cursor"
    When createAgent is called
    Then the factory selects the Cursor runner

  @unit
  Scenario: Factory rejects unknown assistant names
    Given AGENT_UNDER_TEST is set to "unknown-assistant"
    When createAgent is called
    Then the factory throws an error identifying the unknown agent name
    And the error message lists valid assistant names

  # ──────────────────────────────────────────────────
  # R5: Skill placement abstraction
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Runner copies skill directory tree including _shared content
    Given a skill at skills/tracing/ contains SKILL.md and _shared/ directory
    When createAgent is called with a skillPath pointing to SKILL.md
    Then the runner copies SKILL.md to <skillsDir>/<name>/SKILL.md
    And the runner copies the _shared/ directory alongside it
    And the full skill directory tree is preserved

  @unit
  Scenario: Claude Code runner generates CLAUDE.md pointing to skills
    Given the Claude Code runner needs a CLAUDE.md referencing skills
    When createAgent is called with a skillPath
    Then a CLAUDE.md file is generated in the working directory
    And it points to the skills directory

  @unit
  Scenario: Codex runner skips config file generation
    Given the Codex runner has no configFile defined
    When createAgent is called with a skillPath
    Then no config file is generated
    And skills are placed in the correct directory without additional config

  @unit
  Scenario: Cursor runner generates .cursorrules pointing to skills
    Given the Cursor runner needs a .cursorrules referencing skills
    When createAgent is called with a skillPath
    Then a .cursorrules file is generated in the working directory
    And it points to the .cursor/rules skills directory

  # ──────────────────────────────────────────────────
  # R6: Missing binary handling
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Runner throws descriptive error when binary is not found
    Given the cursor-agent binary is not installed on the system
    When a test attempts to create an agent via the Cursor runner
    Then the runner throws a descriptive error identifying the missing binary
    And the error message includes installation instructions or a URL

  @unit
  Scenario: Test suite skips gracefully when selected runner is unavailable
    Given AGENT_UNDER_TEST is set to "cursor"
    And the cursor-agent binary is not installed
    When the test suite starts
    Then all tests report as skipped with a reason
    And no test reports as failed due to the missing binary

  # ──────────────────────────────────────────────────
  # R7: Test runner scripts
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Default pnpm test runs Claude Code without env var
    Given a developer runs pnpm test without setting AGENT_UNDER_TEST
    Then tests run against Claude Code by default
    And behavior is identical to the pre-migration test command

  # ──────────────────────────────────────────────────
  # R8: Capability-aware test skipping
  # ──────────────────────────────────────────────────

  @unit
  Scenario: MCP-dependent tests skip on runners without MCP support
    Given a test uses it.skipIf based on runner.capabilities.supportsMcp
    When tests run against the Codex runner
    Then tests requiring MCP tools are skipped
    And tests not requiring MCP still execute normally

  @unit
  Scenario: MCP-dependent tests run on runners with MCP support
    Given a test uses it.skipIf based on runner.capabilities.supportsMcp
    When tests run against the Cursor runner
    Then all tests execute including MCP-dependent ones

  # ──────────────────────────────────────────────────
  # R9: Runner attribution in logs
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Log output prefixed with runner name for diagnostics
    Given a runner is executing a scenario
    When the runner logs output from the spawned process
    Then each log line is prefixed with the runner name
