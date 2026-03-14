@skills @compiler
Feature: Prompt compilation pipeline
  As the LangWatch team
  We want to compile skills into ready-to-copy prompts
  So that users can paste a single prompt into their agent without knowing about skills

  Background:
    Given a compiler exists at skills/_compiler/
    And skills exist in the skills/ folder following AgentSkills standard

  # ──────────────────────────────────────────────────
  # Compilation
  # ──────────────────────────────────────────────────

  Scenario: Compiler generates a prompt from a single skill
    Given the skill "instrument" exists at skills/instrument/SKILL.md
    When the compiler runs for skill "instrument"
    Then it produces a self-contained prompt text
    And the prompt includes the skill instructions inlined
    And the prompt includes MCP installation steps
    And the prompt includes a placeholder for the LangWatch API key

  Scenario: Compiler generates a prompt from composed skills
    Given the skills "instrument", "experiment", "scenario-test", and "prompt-versioning" exist
    When the compiler runs for the "level-up" composition
    Then it produces a single prompt that orchestrates all skills
    And each skill's instructions are included in sequence
    And shared content is deduplicated (MCP setup appears once)

  Scenario: Compiler injects API key placeholder for platform pages
    Given the compiler runs for any skill
    When the output mode is "platform" (for onboarding/setup pages)
    Then the prompt includes a literal API key value placeholder: {{LANGWATCH_API_KEY}}
    And the platform frontend replaces this with the user's actual API key

  Scenario: Compiler generates "ask for API key" for docs pages
    Given the compiler runs for any skill
    When the output mode is "docs" (for documentation pages)
    Then the prompt instructs the agent to ask the user for their API key
    And it tells the agent to direct users to https://app.langwatch.ai/authorize

  # ──────────────────────────────────────────────────
  # Output formats
  # ──────────────────────────────────────────────────

  Scenario: Compiler produces prompt output
    Given the compiler runs for skill "instrument"
    When the output format is "prompt"
    Then it generates a plain text prompt ready to copy-paste

  Scenario: Compiler produces skill installation output
    Given the compiler runs for skill "instrument"
    When the output format is "skill"
    Then it generates instructions for installing the skill via npx skills-add

  Scenario: Compiler produces MCP-only output
    Given the compiler runs for any skill
    When the output format is "mcp"
    Then it generates MCP installation instructions only
    And lists what the user can ask with the MCP installed

  # ──────────────────────────────────────────────────
  # Onboarding page integration
  # ──────────────────────────────────────────────────

  Scenario: Onboarding page shows three tabs
    Given a user is on the onboarding page
    Then they see three options: "Prompts", "Skills", and "MCP"
    And "Prompts" is the default selected option
    And each tab shows the appropriate compiled output
