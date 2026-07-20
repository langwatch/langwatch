Feature: Separate experiments from online evaluations
  As a LangWatch user
  I want testing and production evaluation workflows to have distinct entry points
  So that I can choose the right workflow without learning LangWatch's internal terminology first

  Background:
    Given LangWatch defines experiments as pre-deployment batch tests over datasets
    And LangWatch defines online evaluations as production monitoring over incoming traces or threads
    And guardrails synchronously act on live application traffic
    And evaluators are reusable scoring functions shared by those workflows

  Scenario: Organize the existing destinations around the product lifecycle
    Given I open a project's primary navigation
    Then the existing "Evaluate" section is named "Test"
    And "Test" contains "Simulations", "Experiments", and "Annotations" in that order
    And the existing "Build" section is named "Library"
    And "Library" contains "Prompts", "Agents", "Workflows", "Evaluators", "Datasets", and "Automations" in that order
    And "Observe" contains its existing destinations followed by the menu label "Online evals" after "Traces"
    And the destination page and product copy keep the full name "Online Evaluations"
    And "Automations" is not listed in "Observe"
    And the remaining destinations keep their current section, name, and order

  Scenario: Collapse primary navigation sections
    Given the project navigation is expanded
    Then every primary section has a visible caret and an accessible expand or collapse control
    And each caret is positioned immediately beside its section label
    When I collapse a section
    Then its destinations are hidden
    And the preference is restored after I reload the application

  Scenario: Focus automation work by purpose
    Given I open Automations from "Library"
    Then I can use a local navigation to open "Automations", "Alerts", "Schedules", or "Recent activity"
    And each destination has its own URL
    And each destination shows only the controls and records for that purpose
    And the automation content uses a readable maximum width instead of stretching across the page

  Scenario: Use sensible section defaults without a saved preference
    Given I have no saved primary navigation preferences
    When I open a project
    Then "Observe", "Test", and "Govern" are expanded
    And "Library" is collapsed

  Scenario: Discover experiments as a distinct testing workflow
    Given I want to test or compare an application before deployment
    When I scan the "Test" section
    Then I can open an "Experiments" destination without opening an online evaluation screen
    And the experiments page contains experiment-specific language and actions
    And the page does not list online evaluations or guardrails

  Scenario: Discover online evaluations as a distinct observation workflow
    Given I want to monitor application quality in production
    When I scan the "Observe" section
    Then I can open an "Online evals" destination without opening an experiments screen
    And its page heading uses the full name "Online Evaluations"
    And the page explains that configured evaluations run on live traces or threads
    And the page does not list experiments
    And its primary actions create an online evaluation or configure a guardrail

  Scenario: Scan online evaluation performance in the configuration table
    Given online evaluations have recent analytics results
    When I open the online evaluations page
    Then each online evaluation is represented by one table row
    And the row includes a compact performance chart
    And the row includes a current value and an up or down trend indicator
    And improving trends are green
    And declining trends are red
    And unavailable trends have an explicit neutral state

  Scenario: Use the available width for online evaluation configuration
    Given the online evaluations page has configured rows
    When the content area is wider than the table's minimum readable width
    Then the explanatory copy and configuration table expand to the available content width
    And the layout does not constrain the table to a compact centered column
    And the experiments table follows the same full-width list layout

  Scenario: Open analytics for one online evaluation
    Given I am viewing an online evaluation row
    When I select its performance preview
    Then I reach analytics filtered to that online evaluation
    When I choose "View analytics" from the row actions
    Then I reach the same filtered analytics destination

  Scenario: Configure guardrails from the production workflow
    Given I need an evaluator to block or act on unsafe live traffic
    When I visit the online evaluations destination
    Then guardrails are presented as the synchronous enforcement path for production traffic
    And the distinction between asynchronous online evaluations and synchronous guardrails is visible before creation

  Scenario: Browse shared evaluators without conflating workflows
    Given experiments, online evaluations, and guardrails can reuse evaluator definitions
    When I browse or create an evaluator
    Then the interface describes it as a reusable scoring function
    And the interface does not imply that the evaluator itself is an experiment or an online evaluation
    And workflow-specific entry points return me to the workflow I started from

  Scenario: Interpret evaluation analytics as production results
    Given online evaluation results appear in analytics
    When I encounter evaluation metrics or configuration links there
    Then the labels identify them as online evaluation results
    And links to configuration lead to the online evaluations destination
    And no analytics label implies that experiment runs are configured on that screen

  Scenario: Preserve existing project access during the navigation migration
    Given I use a saved URL or in-product link for the current evaluations page
    When the separated destinations are released
    Then I reach the corresponding supported destination without losing project context
    And links to a specific experiment, online evaluation, evaluator, or guardrail continue to resolve

  Scenario: Show only experiment actions authorized by their server contracts
    Given I can view experiments in the current project
    When I open the experiments page
    Then the experiment list is available with "experiments:view"
    And create and edit actions require "workflows:create"
    And delete actions require "workflows:delete"
    And replicate actions require "evaluations:manage"

  Scenario: Use the experiments skill for batch testing
    Given an agent has the LangWatch experiments skill
    When the user asks to batch test, benchmark, compare configurations, or create a CI quality gate
    Then the agent follows the experiments workflow
    And it runs a real experiment against domain-specific data
    And it does not configure production monitoring unless the user also asks for it

  Scenario: Use the online evaluations skill for production monitoring and enforcement
    Given an agent has the LangWatch online evaluations skill
    When the user asks to monitor production quality, evaluate live traffic, or add a guardrail
    Then the agent follows the online evaluation or guardrail workflow
    And it does not create a batch experiment unless the user also asks for it

  Scenario: Hand off an intent to the companion skill
    Given the loaded skill does not match the user's intent
    When the request belongs to the companion experiments or online evaluations workflow
    Then the agent names the correct companion skill
    And it loads that skill when available
    And otherwise it provides the exact command to install it before continuing
    And it does not reproduce the companion skill's full instructions from memory

  Scenario: Route legacy evaluation skill requests without mixing workflows
    Given an agent or user requests the legacy evaluations skill
    When the intended workflow can be inferred
    Then the request is routed to the experiments or online evaluations skill
    And ambiguous requests explain the distinction before choosing a workflow

  Scenario: Prove both skills independently with real services
    Given the experiments and online evaluations skills have separate scenario suites
    When their dogfooding tests run with configured provider and LangWatch credentials
    Then the experiments suite creates and executes a real experiment
    And the online evaluations suite creates and verifies a real online evaluation or guardrail
    And each suite detects accidental crossover into the other workflow
