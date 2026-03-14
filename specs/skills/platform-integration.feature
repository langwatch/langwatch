@skills @platform
Feature: Skills integration across all platform touchpoints
  As the LangWatch team
  We want skills/prompts to appear everywhere users might need onboarding
  So that no user hits a blank screen without a path to get started

  # ──────────────────────────────────────────────────
  # Platform empty states
  # ──────────────────────────────────────────────────

  Scenario: Messages page shows prompt when no traces exist
    Given a user has a project with zero traces
    When they visit the messages/traces page
    Then they see an option to copy a prompt to instrument their code
    And they see an option to install the LangWatch skill
    And they see a link to manual setup instructions

  Scenario: Datasets page shows prompt when empty
    Given a user has a project with zero datasets
    When they visit the datasets page
    Then they see an option to copy a prompt to create an experiment with a dataset
    And they see the standard "+ Add" button as well

  Scenario: Evaluators page shows prompt when empty
    Given a user has a project with zero saved evaluators
    When they visit the evaluators page
    Then they see an option to copy a prompt to set up evaluations
    And they see the standard creation flow as well

  Scenario: Simulations page shows prompt when no scenarios exist
    Given a user has a project with zero scenarios
    When they visit the simulations page
    Then they see an option to copy a prompt to add scenario tests
    And they see options for both dev (code) and platform paths

  # ──────────────────────────────────────────────────
  # Onboarding pages
  # ──────────────────────────────────────────────────

  Scenario: Onboarding page for devs using claude code
    Given a user selects the "Devs using Claude Code" path
    Then they see goal-based options:
      | goal                                     |
      | Instrument my code with LangWatch        |
      | Create an evaluation experiment           |
      | Add agent simulation tests                |
      | Version my agent prompts                  |
      | Red team my agent for vulnerabilities     |
      | All of the above                          |
    And each goal has three tabs: Prompts, Skills, MCP
    And "Prompts" is the default tab
    And the prompt tab shows a copy-paste prompt with their API key injected

  Scenario: Onboarding page for PMs using claude web
    Given a user selects the "PMs using Claude on the web" path
    Then they see goal-based options:
      | goal                                      |
      | Create an experiment to test my prompt     |
      | Write scenario simulation tests            |
      | Tell me how my agent has been performing    |
    And each goal shows a copy-paste prompt

  Scenario: Onboarding page for PMs via platform
    Given a user selects the "PMs via the platform" path
    Then they see links to platform features:
      | feature            | link                    |
      | Experiments        | /experiments            |
      | Scenarios          | /simulations            |
      | Prompt Playground  | /prompts                |

  Scenario: Onboarding page for devs manual setup
    Given a user selects the "Devs manual setup" path
    Then they see the current framework-specific integration guides
    And links to SDK documentation

  # ──────────────────────────────────────────────────
  # Documentation integration
  # ──────────────────────────────────────────────────

  Scenario: Docs getting-started pages reflect the four paths
    Given the LangWatch documentation site
    When a user visits any getting-started or quickstart page
    Then they see the four onboarding paths prominently
    And each path links to the appropriate prompts/skills/MCP instructions

  Scenario: Docs integration pages link back to skills
    Given the LangWatch documentation site
    When a user visits a framework integration page (e.g. OpenAI, LangGraph)
    Then the page links to the "instrument" skill/prompt as an alternative
    And explains they can paste a single prompt instead of following manual steps

  # ──────────────────────────────────────────────────
  # API key handling
  # ──────────────────────────────────────────────────

  Scenario: API key is injected in platform-generated prompts
    Given a user copies a prompt from the onboarding page
    Then the prompt contains their actual API key (not a placeholder)
    And the prompt instructs the agent to add it to .env and MCP config

  Scenario: API key is requested in docs-generated prompts
    Given a user copies a prompt from the documentation site
    Then the prompt contains a placeholder for the API key
    And the prompt instructs the agent to ask the user for their key
    And the prompt directs users to https://app.langwatch.ai/authorize
