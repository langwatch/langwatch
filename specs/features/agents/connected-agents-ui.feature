Feature: Connected agents in the product
  As a person who runs simulations
  I want to see the agents my team connected from code and pick them
  So that I can run a suite against a process that is running right now

  # The screens of ADR-128: the agents page, the agent drawer, the run
  # dialog target picker and the run settings of a finished run. The
  # platform already answers with the environment, the status, the
  # instances, the owner and the declared parameters of every agent.
  #
  # @see dev/docs/adr/128-connected-agents.md
  # @see specs/agents/connected-agents.feature

  Background:
    Given a project with connected agents registered from code

  # ---------------------------------------------------------------------------
  # The agents page
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Every connected agent is a card of the agents page
    Given "support-agent" is registered in "production" and in "development"
    When the agents page reads the project
    Then one card is drawn for each of them
    And each card names the agent and its own environment

  @integration
  Scenario: The environment reads in a colour of its own
    Given "support-agent" in "production", in "development" and in "staging"
    When the cards are drawn
    Then "production" and "development" read in two different colours
    And "staging" reads in the neutral colour

  @integration
  Scenario: An online agent reads how many instances hold it
    Given "support-agent" in "production" has three connected instances
    When the card is drawn
    Then its presence mark is the online one
    And the mark carries "Online · 3 instances"
    And the card reads "3 instances"

  @integration
  Scenario: An agent with one instance reads it in the singular
    Given "support-agent" in "production" has one connected instance
    When the card is drawn
    Then the mark carries "Online · 1 instance"

  @integration
  Scenario: An offline agent reads when it was last seen
    Given "support-agent" in "production" has no connected instance
    And it was last seen two hours ago
    When the card is drawn
    Then its presence mark is the offline one
    And the mark carries "Offline · last seen 2 hours ago"

  @integration
  Scenario: A personal development agent reads its owner
    Given "support-agent" in "development" belongs to a person
    When the card is drawn
    Then it carries a chip with the owner's name

  @integration
  Scenario: A shared development agent reads the machine that holds it
    Given "support-agent" in "development" belongs to no person and names a machine
    When the card is drawn
    Then it carries a chip with the machine name

  @integration
  Scenario: A card names the SDK and the parameters the agent declares
    Given "support-agent" registered from the Python SDK with a "model" parameter
    When the card is drawn
    Then it names the SDK and its version
    And it names the "model" parameter

  @integration
  Scenario: A click on the card opens the connected agent
    Given a connected agent on the agents page
    When its card is clicked
    Then the connected agent drawer is opened for that agent

  @integration
  Scenario: The card menu opens the agent and deletes it
    Given a connected agent on the agents page
    When the menu of the card is opened
    Then it offers to open the agent and to delete it
    And the menu is drawn above the cards, never cut by the card

  @integration
  Scenario: The page offers the connect snippets when no agent is connected
    Given the project has no connected agent
    When the agents page is drawn
    Then it reads "Connect an agent from code"
    And it offers a Python snippet and a TypeScript snippet
    And it shows that the page is listening for the agent

  @integration
  Scenario: The connect empty state keeps the way to the other agent kinds
    Given the project has no connected agent
    When the agents page is drawn
    Then a control still opens the new agent flow

  # ---------------------------------------------------------------------------
  # The agent drawer
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The drawer lists the parameters the agent declares
    Given a connected agent that declares "model" with two options and a default
    When its drawer is open
    Then the parameters table names the parameter, its type, its options and its default

  @integration
  Scenario: The drawer lists the instances that hold the agent
    Given a connected agent with one connected instance
    When its drawer is open
    Then the instances table names the hostname, the label, the process id and the time it connected

  @integration
  Scenario: The drawer edits the description and nothing else
    Given a connected agent
    When its drawer is open
    Then the description can be edited
    And the name, the environment and the parameters cannot

  @integration
  Scenario: The drawer sends one test turn to the agent
    Given an online connected agent
    When a message is typed and the test is started
    Then the agent's answer is shown with the instance that served it

  # ---------------------------------------------------------------------------
  # The run dialog and the target selector
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The target picker marks an online agent and an offline one
    Given one connected agent online and one offline
    When the run dialog is open
    Then the online agent is marked online and the offline one offline

  @integration
  Scenario: The target picker reads the environment of a connected agent
    Given "support-agent" in "production"
    When the run dialog is open
    Then the card reads "support-agent · production"

  @integration
  Scenario: Teammates' development agents are hidden until the toggle is on
    Given a development agent that belongs to another person
    When the run dialog is open
    Then that agent is not offered
    And it is offered after "Show teammates' development agents" is turned on

  @integration
  Scenario: A teammate's development agent cannot be chosen
    Given the teammates toggle is on
    When a development agent of another person is drawn
    Then it is disabled and says only its owner can run it

  @integration
  Scenario: The dialog warns when the chosen agent is offline
    Given an offline connected agent is chosen
    When the run dialog is drawn
    Then it warns that no process is running the agent

  # ---------------------------------------------------------------------------
  # The results of a run
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A target label carries the environment and the owner
    Given a run against "support-agent" in "development" owned by a person
    When the run settings are drawn
    Then the target reads "support-agent · development (Ana)"

  @integration
  Scenario: The run settings name the instance that served a target
    Given a run whose target was served by one instance
    When the run settings are drawn
    Then the target line names that instance

  @integration
  Scenario: A target served by no connected instance names none
    Given a run against an HTTP agent
    When the run settings are drawn
    Then the target line names no instance
