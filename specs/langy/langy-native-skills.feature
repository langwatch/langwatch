Feature: Langy loads its skills from the canonical skill directory
  As the owner of the Langy in-product assistant
  I want Langy's skills to come from the one canonical skill directory the
  public docs are built from
  So that the assistant can always do everything the directory advertises,
  the instructions never drift from what we publish, and the in-product
  assistant is never handed setup steps it has already completed

  Background:
    Given a Langy conversation has started for my project
    And my project's Langy credentials are already provisioned

  # ---------------------------------------------------------------------------
  # Skills are first-class, not hidden how-to files
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: Langy can use a skill without being told where its instructions live
    When I ask Langy something that maps to the analytics skill
    Then Langy uses the analytics skill to answer
    And Langy did not have to be told the location of the skill's instructions

  @integration @unimplemented
  Scenario: Every skill in the public directory is available to Langy
    Given the public skill directory lists a set of skills
    When a Langy conversation starts
    Then each listed skill is available to the assistant by name

  # ---------------------------------------------------------------------------
  # Single source of truth — no drift
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: Adding a skill to the canonical directory makes it available to Langy
    Given a new skill is added to the canonical skill directory
    When a Langy conversation starts
    Then that skill is available to the assistant
    And no separate copy of the skill had to be hand-written for Langy

  @integration @unimplemented
  Scenario: A skill's instructions match what the public directory publishes
    Given a skill that appears in the public directory
    When the assistant uses that skill
    Then the instructions it follows are the same ones we publish for that skill

  # ---------------------------------------------------------------------------
  # In-product context: never re-do setup the worker already completed
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: Langy never asks for an API key it already has
    When the assistant uses any skill
    Then it does not ask me for a LangWatch API key
    And it does not direct me to create or paste one

  @integration @unimplemented
  Scenario: Langy never tells me to install tooling that is already present
    When the assistant uses any skill
    Then it does not instruct me to install the LangWatch CLI

  # ---------------------------------------------------------------------------
  # Langy-only skills coexist with the canonical ones
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: A Langy-specific skill is available alongside the canonical skills
    Given a skill that only applies inside the Langy product, such as opening a pull request
    When a Langy conversation starts
    Then that skill is available to the assistant
    And it is offered the same way as the canonical skills

  # ---------------------------------------------------------------------------
  # A skill body is read by the customer, not only by the agent
  # ---------------------------------------------------------------------------

  # The agent reads a skill as tool output, and the reader sees that output in
  # the tool card. So anything in a skill that describes the machine we run on
  # reaches them. One answer about where scenario results live carried a
  # worker-side host, which says how the product is wired and nothing about the
  # question that was asked.
  #
  # Naming a variable the customer sets in their own .env is the opposite of a
  # leak: it is how the agent learns a project is self-hosted and how it
  # authenticates at all. The rule is about what the agent says, not what it
  # reads, and it is the operating contract that carries it.

  @unit
  Scenario: A skill never hands the customer a path from the machine it runs on
    Given the set of skills Langy ships with
    When each one is rendered
    Then none of them names a home directory or a machine-local path

  @unit
  Scenario: A skill never hands the customer an address only the worker can reach
    Given the set of skills Langy ships with
    When each one is rendered
    Then none of them names a loopback, container or internal host

  @unit
  Scenario: The setup guidance still names the variables the agent has to find
    Given the skill whose subject is environment setup
    When it is rendered
    Then it names the API key variable the agent reads from the project
    And it names the endpoint variable that says the project is self-hosted
