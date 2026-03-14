@architecture @skills
Feature: Skills-based onboarding architecture
  As the LangWatch team
  We want a skills/ folder with AgentSkills-compliant skills for onboarding
  So that users can onboard via copy-paste prompts, installable skills, or MCP
  And we can prove quality with scenario tests for every skill

  Background:
    Given the skills/ folder exists at the repository root
    And each skill follows the AgentSkills standard (SKILL.md with frontmatter)
    And each skill has scenario tests proving it works against fixture codebases
    And skills pull framework-specific patterns from LangWatch/Scenario docs via MCP
    And agent bias corrections are embedded directly in each skill's SKILL.md

  # ──────────────────────────────────────────────────
  # Skill catalog — dev path (claude code)
  # ──────────────────────────────────────────────────

  @dev @instrument
  Scenario: Skill catalog includes "instrument" for code instrumentation
    Given a skill exists at skills/instrument/SKILL.md
    Then the skill name is "instrument"
    And the description mentions instrumenting code with LangWatch tracing
    And the skill references the LangWatch MCP for framework-specific docs
    And the skill includes fallback instructions if MCP is unavailable
    And the skill covers Python and TypeScript
    And the skill handles multiple frameworks via MCP doc lookup

  @dev @experiment
  Scenario: Skill catalog includes "experiment" for evaluation experiments
    Given a skill exists at skills/experiment/SKILL.md
    Then the skill name is "experiment"
    And the description mentions creating evaluation experiments
    And the skill creates a Jupyter notebook when the project is Python
    And the skill creates a script when the project is TypeScript
    And the agent generates a dataset tailored to the user's application
    And the skill sets up evaluators and LangWatch experiment tracking

  @dev @scenario-test
  Scenario: Skill catalog includes "scenario-test" for agent simulation tests
    Given a skill exists at skills/scenario-test/SKILL.md
    Then the skill name is "scenario-test"
    And the description mentions adding agent simulation tests
    And the skill uses the LangWatch MCP to read Scenario docs
    And the skill creates scenario test files appropriate to the project language
    And the skill explicitly warns against inventing testing frameworks

  @dev @prompt-versioning
  Scenario: Skill catalog includes "prompt-versioning" for prompt management
    Given a skill exists at skills/prompt-versioning/SKILL.md
    Then the skill name is "prompt-versioning"
    And the description mentions versioning agent prompts with LangWatch
    And the skill runs "langwatch prompt init" and "langwatch prompt create"
    And the skill updates application code to fetch prompts from LangWatch
    And the skill includes explicit BAD vs GOOD code examples inline

  @dev @red-team
  Scenario: Skill catalog includes "red-team" for vulnerability testing
    Given a skill exists at skills/red-team/SKILL.md
    Then the skill name is "red-team"
    And the description mentions red teaming agents for vulnerabilities
    And the skill uses the LangWatch MCP to read Scenario red teaming docs
    And the skill uses Scenario's RedTeamAgent for adversarial testing

  @dev @level-up
  Scenario: Skill catalog includes "level-up" as a meta-skill
    Given a skill exists at skills/level-up/SKILL.md
    Then the skill name is "level-up"
    And the description mentions taking an agent to the next level
    And the skill orchestrates instrument, experiment, scenario-test, and prompt-versioning
    And the skill runs each sub-skill in sequence with verification steps

  # ──────────────────────────────────────────────────
  # Skill catalog — platform path (claude web / no codebase)
  # ──────────────────────────────────────────────────

  @platform @platform-experiment
  Scenario: Skill catalog includes "platform-experiment" for prompt testing
    Given a skill exists at skills/platform-experiment/SKILL.md
    Then the skill name is "platform-experiment"
    And the description mentions creating experiments to test prompts
    And the skill uses MCP platform_ tools to create prompts and evaluators
    And the skill explains current limitations around UI experiments and datasets

  @platform @platform-scenario
  Scenario: Skill catalog includes "platform-scenario" for scenario creation
    Given a skill exists at skills/platform-scenario/SKILL.md
    Then the skill name is "platform-scenario"
    And the description mentions writing scenario simulation tests
    And the skill uses MCP platform_ tools to create scenarios on the platform

  @platform @analytics
  Scenario: Skill catalog includes "analytics" for performance insights
    Given a skill exists at skills/analytics/SKILL.md
    Then the skill name is "analytics"
    And the description mentions analyzing agent performance
    And the skill uses MCP search_traces and get_analytics tools
    And the skill works for both devs and PMs

  # ──────────────────────────────────────────────────
  # Shared infrastructure
  # ──────────────────────────────────────────────────

  Scenario: Shared references exist for cross-cutting concerns
    Given a directory exists at skills/_shared/
    Then it contains mcp-setup.md with MCP installation instructions
    And it contains api-key-setup.md with API key acquisition steps
    And it contains llms-txt-fallback.md with doc fetching without MCP

  Scenario: Every skill references MCP setup
    Given any skill SKILL.md in skills/
    Then it references skills/_shared/mcp-setup.md for MCP installation
    And it includes instructions to install the LangWatch MCP for the agent

  Scenario: Every dev skill includes MCP fallback
    Given any dev skill SKILL.md in skills/
    Then it includes fallback instructions for when MCP installation fails
    And the fallback teaches the agent to fetch docs via llms.txt URLs
