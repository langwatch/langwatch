@skills @recipes
Feature: Agent insight skills, from diagnosis to improvement
  As a developer running an agent in production
  I want skills that diagnose my agent from real traces and turn findings into tested improvements
  So that I continuously improve the agent instead of guessing

  # Three skills form a ladder on the public skills directory (Recipes section):
  #   1. agent-improve (starred, top): what should I do next
  #   2. agent-performance: how is my agent performing
  #   3. agent-best-practices: where can I improve our development practices
  # agent-performance hands off to agent-improve; agent-improve uses
  # performance evidence to justify every proposal.

  Scenario: Directory lists the three skills in the insight ladder order
    Given a visitor opens the skills directory Recipes section
    Then the first entry is the starred "What should I do next to improve my agent?" installing agent-improve
    And an entry "How is my agent performing?" installs agent-performance
    And an entry "Where can I improve our agent development best practices?" installs agent-best-practices
    And no entry references the retired improve-setup or analytics install paths

  Scenario: agent-best-practices audits the development setup
    Given a project with an agent codebase connected to LangWatch
    When the user asks where they can improve their agent development best practices
    Then the skill audits the codebase and the LangWatch resources through the CLI
    And reports gaps against best practices such as missing scenarios, unversioned prompts, or absent monitors
    And fixes the highest-impact gaps first before suggesting deeper improvements

  Scenario: agent-performance produces a full diagnosis from production traces
    Given a project with production traces in LangWatch
    When the user asks how their agent is performing
    Then the skill explores analytics trends and individual traces through the LangWatch APIs
    And maps failure patterns, dissatisfied users, token cost hotspots, edge cases, behavior changes, and outliers
    And every claim links to concrete example traces in the LangWatch app
    And the skill writes an HTML report of the diagnosis for the user to open
    And the skill closes by recommending the agent-improve skill, including how to install it when missing

  Scenario: agent-performance stays within read-only analysis
    Given a user asks how their agent is performing
    When the skill runs
    Then it only reads data and writes the report file
    And it does not modify the agent codebase or platform resources

  Scenario: agent-improve proposes evidence-backed improvements
    Given a project with production traces and an agent codebase
    When the user asks what they should do next to improve their agent
    Then the skill gathers evidence from traces and analytics before proposing anything
    And proposes hypotheses that are each explained with the evidence behind them
    And each proposal is actionable as a scenario test, a prompt or code change, a new evaluator or monitor, or an experiment
    And the user understands why each hypothesis is worth testing before anything is created

  Scenario: agent-improve turns accepted hypotheses into artifacts
    Given the user accepts a proposed hypothesis
    When the skill executes the proposal
    Then failing cases from production become scenario tests that reproduce them
    And production signals worth capturing become evaluators or monitors
    And prompt or code changes are prepared as a reviewable change set for a pull request

  Scenario: The PM platform prompt keeps working
    Given the PM and domain experts page offers "How is my agent performing?"
    When a PM copies the platform prompt
    Then the prompt still guides them through the LangWatch platform analytics
