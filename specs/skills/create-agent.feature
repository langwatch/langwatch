Feature: Create Agent Skill
  As a developer using Claude Desktop (Code mode)
  I want to scaffold a complete AI agent project from an empty directory
  So that I get a production-ready agent with LangWatch instrumentation, prompt versioning, evaluation experiments, and scenario tests without needing a separate CLI tool

  Background:
    Given a compiled prompt for create-agent exists at _compiled/create-agent.platform.txt
    And the create-agent SKILL.md exists at skills/create-agent/SKILL.md

  # ───────────────────────────────────────────────────────────────────
  # R1: SKILL.md — Project scaffolding from scratch
  # ───────────────────────────────────────────────────────────────────

  @e2e
  Scenario: Scaffolds a Python Agno agent project from an empty directory
    Given an empty directory
    When the user asks to create a customer support agent
    And selects Agno as the framework and OpenAI as the LLM provider
    Then the project contains an agent source directory at app/
    And the project contains prompts/ with at least one YAML prompt file and a prompts.json registry
    And the project contains tests/scenarios/ with scenario test files
    And the project contains tests/evaluations/ with a Jupyter notebook
    And the project contains .env and .env.example files
    And the project contains .mcp.json and .mcp.json.example files
    And the project contains AGENTS.md and CLAUDE.md
    And the agent source code includes LangWatch instrumentation

  @e2e
  Scenario: Scaffolds a TypeScript Vercel AI SDK agent project from an empty directory
    Given an empty directory
    When the user asks to create a data analysis agent
    And selects Vercel AI SDK as the framework and Anthropic as the LLM provider
    Then the project contains an agent source directory at src/
    And the project contains prompts/ with at least one YAML prompt file and a prompts.json registry
    And the project contains tests/scenarios/ with scenario test files
    And the project contains tests/evaluations/ with an evaluation script
    And the project contains .env and .env.example files
    And the project contains .mcp.json and .mcp.json.example files
    And the project contains AGENTS.md and CLAUDE.md
    And the agent source code includes LangWatch instrumentation

  # ── Interactive discovery ──

  @integration
  Scenario: Asks for framework and provider before scaffolding
    Given an empty directory
    When the user asks to create an agent without specifying framework or provider
    Then the skill asks the user to choose a framework from Agno, Mastra, LangGraph, Google ADK, or Vercel AI SDK
    And asks which LLM provider to use from OpenAI, Anthropic, Gemini, Bedrock, OpenRouter, or Grok

  # ── Directory preconditions ──

  @integration
  Scenario: Works from a near-empty directory with only a README or .git
    Given a directory containing only a README.md and a .git directory
    When the user asks to create an agent with Agno and OpenAI
    Then the skill scaffolds the project successfully

  @integration
  Scenario: Warns when directory has existing source code
    Given a directory containing existing Python or TypeScript source files
    When the user asks to create an agent
    Then the skill warns that the directory is not empty
    And suggests using the tracing or instrumentation skills instead

  # ── Environment failures ──

  @integration
  Scenario: Reports missing language runtime
    Given an empty directory
    When the user selects a Python framework but Python is not installed
    Then the skill reports that Python is required and provides installation guidance
    And does not leave a half-scaffolded project

  @integration
  Scenario: Provides recovery when dependency installation fails
    Given an empty directory
    When the project is being scaffolded and dependency installation fails
    Then the skill reports the error clearly
    And provides instructions for the user to manually install dependencies
    And the project structure remains intact for manual recovery

  # ── MCP and secrets ──

  @integration
  Scenario: MCP config includes both LangWatch and framework-specific servers
    Given the user selects Mastra as the framework
    When the project is scaffolded
    Then .mcp.json contains the LangWatch MCP server configuration
    And .mcp.json contains the Mastra framework MCP server configuration

  @integration
  Scenario: Secrets are never committed to git
    When the project is scaffolded
    Then .gitignore includes .env and .mcp.json
    And .env.example contains placeholder keys without real values
    And .mcp.json.example contains placeholder keys without real values
    And .cursor/mcp.json exists for Cursor compatibility

  # ── Evaluation artifacts ──

  @integration
  Scenario: Python projects include a Jupyter evaluation notebook
    Given the user selects a Python framework
    When the project is scaffolded
    Then tests/evaluations/ contains a .ipynb notebook with evaluation cells
    And the notebook uses langwatch.experiment.init()

  @integration
  Scenario: TypeScript projects include an evaluation script
    Given the user selects a TypeScript framework
    When the project is scaffolded
    Then tests/evaluations/ contains a .ts evaluation script
    And the script uses langwatch experiments SDK

  # ── Behavioral constraints ──

  @integration
  Scenario: Reads framework docs before scaffolding
    When the skill runs
    Then it fetches documentation via MCP before writing any project files

  @integration
  Scenario: Runs tests before declaring completion
    Given the project has been scaffolded
    When the skill reaches the verification step
    Then it executes the scenario tests
    And reports whether they pass or fail

  @integration
  Scenario: Does not start long-running dev servers
    When the project is scaffolded
    Then the skill tells the user how to start the dev server
    And does not start any long-running processes itself

  # ── AGENTS.md principles ──

  @integration
  Scenario: AGENTS.md encodes development principles
    When the project is scaffolded
    Then AGENTS.md instructs using @langwatch/scenario for agent testing
    And instructs using LangWatch Prompt CLI for prompt versioning
    And clarifies that evaluations are for metrics only and scenarios for multi-turn flows
    And CLAUDE.md references AGENTS.md

  # ───────────────────────────────────────────────────────────────────
  # R2: Framework Knowledge Embedding
  # ───────────────────────────────────────────────────────────────────

  @integration
  Scenario: Framework reference files exist for all supported frameworks
    Given the skill directory at skills/create-agent/
    Then references/ contains guides for Agno, Mastra, LangGraph Python, LangGraph TypeScript, Google ADK, and Vercel AI SDK
    And each guide includes scaffolding instructions, source directory convention, LangWatch integration pattern, framework MCP config, and known pitfalls

  @integration
  Scenario: Skill loads only the selected framework reference
    Given the user selects LangGraph Python as the framework
    When the skill prepares to scaffold
    Then it reads the LangGraph Python reference
    And does not load references for Agno, Mastra, or other frameworks

  # ───────────────────────────────────────────────────────────────────
  # R3: Compiled Prompt
  # ───────────────────────────────────────────────────────────────────

  @integration
  Scenario: Compiler produces platform-mode output
    When the compiler runs for create-agent in platform mode
    Then it outputs _compiled/create-agent.platform.txt
    And the output contains {{LANGWATCH_API_KEY}} as a placeholder
    And the output is self-contained with no unresolved file references

  @integration
  Scenario: Compiler produces docs-mode output
    When the compiler runs for create-agent in docs mode
    Then it outputs _compiled/create-agent.docs.txt
    And the output instructs the agent to ask the user for their API key
    And the output references https://app.langwatch.ai/authorize
    And the output is self-contained with no unresolved file references

  @integration
  Scenario: Compiled prompt keeps framework selection interactive
    Given a compiled prompt for create-agent
    Then the prompt does not hardcode a specific framework
    And instructs the agent to ask the user which framework to use

  # ───────────────────────────────────────────────────────────────────
  # R4: Scenario Tests — Framework Matrix
  # ───────────────────────────────────────────────────────────────────

  # R1 e2e tests cover Agno (Python) and Vercel AI SDK (TypeScript).
  # R4 adds LangGraph Python and Mastra TypeScript to complete the matrix.

  @e2e
  Scenario: Creates a Python LangGraph agent from scratch
    Given an empty temp directory
    When the create-agent skill runs with LangGraph and Python selected
    Then the project contains app/ with LangWatch-instrumented source code
    And the project contains prompts/ with YAML files and prompts.json
    And the project contains tests/scenarios/ and tests/evaluations/
    And AGENTS.md exists with development principles

  @e2e
  Scenario: Creates a TypeScript Mastra agent from scratch
    Given an empty temp directory
    When the create-agent skill runs with Mastra and TypeScript selected
    Then the project contains src/ with LangWatch-instrumented source code
    And the project contains prompts/ with YAML files and prompts.json
    And the project contains tests/scenarios/ and tests/evaluations/
    And AGENTS.md exists with development principles

  # ───────────────────────────────────────────────────────────────────
  # R5: Lessons Learned Guard Rails
  # ───────────────────────────────────────────────────────────────────

  @integration
  Scenario: Skill includes guard rails against known agent failure modes
    Given the create-agent SKILL.md
    Then it instructs the agent to use @langwatch/scenario and not create a custom testing framework
    And to read scenario docs via MCP fetch_scenario_docs
    And to create prompts via langwatch prompt CLI, never hardcode in code
    And to use MCP fetch_langwatch_docs for documentation, never guess URLs
    And to write files directly, never use platform_* MCP tools in a code environment
    And to use evaluations for metrics only, scenarios for multi-turn conversations
    And to use natural language judge criteria, not regex or string matching
    And to create .mcp.json (gitignored) and .mcp.json.example (committed)
    And to run scenario tests before declaring the project complete
    And to tell the user how to start the dev server, not start it itself

  @integration
  Scenario: Skill follows docs-first then scaffold sequence
    Given the create-agent SKILL.md
    Then the skill reads documentation via MCP before any scaffolding
    And scaffolds the project structure before instrumenting code
    And runs verification tests before declaring completion
