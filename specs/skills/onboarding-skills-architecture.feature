@architecture @skills
Feature: Skills-based onboarding architecture
  As the LangWatch team
  We want a skills/ folder with AgentSkills-compliant skills for onboarding
  So that users can onboard via copy-paste prompts or installable skills
  And we can prove quality with scenario tests for every skill

  Background:
    Given the skills/ folder exists at the repository root
    And each skill follows the AgentSkills standard (SKILL.md with frontmatter)
    And each skill has scenario tests proving it works against fixture codebases
    And skills pull framework-specific patterns from LangWatch/Scenario docs via the `langwatch` CLI
    And the CLI is the only documentation surface skills point at — there are no MCP install steps in skills
    And agent bias corrections are embedded directly in each skill's SKILL.md

  # ──────────────────────────────────────────────────
  # Feature skills (handle both code and platform approaches)
  # ──────────────────────────────────────────────────

  @dev @tracing
  Scenario: Skill catalog includes "tracing" for code instrumentation
    Given a skill exists at skills/tracing/SKILL.md
    Then the skill name is "tracing"
    And the description mentions adding LangWatch tracing and observability
    And the skill instructs the agent to read framework docs via "langwatch docs"
    And the skill includes a fallback link for fetching docs directly via llms.txt URLs
    And the skill never instructs the agent to install or use the LangWatch MCP
    And the skill covers Python and TypeScript
    And the skill handles multiple frameworks via doc lookup
    And the skill supports both onboarding and targeted modes

  @dev @evaluations
  Scenario: Skill catalog includes "evaluations" for comprehensive evaluations
    Given a skill exists at skills/evaluations/SKILL.md
    Then the skill name is "evaluations"
    And the description covers experiments, evaluators, datasets, online evaluation, and guardrails
    And the skill disambiguates what the user needs based on their request
    And the skill creates experiments (notebooks/scripts) for batch testing
    And the skill guides guardrail setup for real-time blocking
    And the skill explains how to set up online evaluation via the platform
    And the agent generates datasets tailored to the user's application
    And the skill auto-detects code vs platform context
    And the skill uses `langwatch evaluator`, `langwatch dataset`, and `langwatch monitor` CLI commands for platform operations
    And the skill never references MCP tools
    And the skill supports both onboarding and targeted modes

  @dev @scenarios
  Scenario: Skill catalog includes "scenarios" for agent simulation tests
    Given a skill exists at skills/scenarios/SKILL.md
    Then the skill name is "scenarios"
    And the description mentions testing agents with simulation-based scenarios
    And the skill instructs the agent to read Scenario docs via "langwatch scenario-docs"
    And the skill creates scenario test files appropriate to the project language
    And the skill explicitly warns against inventing testing frameworks
    And the skill auto-detects code vs platform context
    And the skill supports red teaming via RedTeamAgent
    And the skill uses `langwatch scenario` and `langwatch suite` CLI commands for platform operations
    And the skill never references MCP tools
    And the skill supports both onboarding and targeted modes

  @dev @prompts
  Scenario: Skill catalog includes "prompts" for prompt management
    Given a skill exists at skills/prompts/SKILL.md
    Then the skill name is "prompts"
    And the description mentions versioning and managing agent prompts
    And the skill runs "langwatch prompt init" and "langwatch prompt create"
    And the skill instructs the agent to read the Prompts CLI docs via "langwatch docs prompt-management/cli"
    And the skill updates application code to fetch prompts from LangWatch
    And the skill includes explicit BAD vs GOOD code examples inline
    And the skill never references MCP tools
    And the skill supports both onboarding and targeted modes

  @dev @level-up
  Scenario: Skill catalog includes "level-up" as a meta-skill
    Given a skill exists at skills/level-up/SKILL.md
    Then the skill name is "level-up"
    And the description mentions taking an agent to the next level
    And the skill orchestrates tracing, prompts, evaluations, and scenarios
    And the skill runs each sub-skill in sequence with verification steps
    And every sub-step uses CLI commands (`langwatch docs ...`, `langwatch prompt ...`, etc.) — not MCP tools

  # ──────────────────────────────────────────────────
  # Cross-cutting skills
  # ──────────────────────────────────────────────────

  @platform @analytics
  Scenario: Skill catalog includes "analytics" for performance insights
    Given a skill exists at skills/analytics/SKILL.md
    Then the skill name is "analytics"
    And the description mentions analyzing agent performance
    And the skill uses `langwatch analytics query`, `langwatch trace search`, and `langwatch trace get` CLI commands
    And the skill never references MCP tools
    And the skill works for both devs and PMs

  # ──────────────────────────────────────────────────
  # Shared infrastructure
  # ──────────────────────────────────────────────────

  Scenario: Shared references exist for cross-cutting concerns
    Given a directory exists at skills/_shared/
    Then it contains cli-setup.md with CLI installation and docs commands
    And it contains api-key-setup.md with API key acquisition steps
    And it contains llms-txt-fallback.md with doc fetching for environments where the CLI cannot run
    And it does NOT contain mcp-setup.md (removed — CLI is the only documentation surface)

  Scenario: Every skill references the CLI setup
    Given any skill SKILL.md in skills/
    Then it references skills/_shared/cli-setup.md for CLI installation
    And it includes instructions to install the LangWatch CLI for the agent
    And it does NOT instruct the agent to install or configure the LangWatch MCP

  Scenario: Every dev skill includes a docs fallback for shell-less environments
    Given any dev skill SKILL.md in skills/
    Then it includes a link to skills/_shared/llms-txt-fallback.md
    And the fallback teaches the agent to fetch docs via llms.txt URLs when the `langwatch` CLI cannot be run (e.g. inside ChatGPT)
