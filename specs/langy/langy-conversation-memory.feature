Feature: Langy remembers what this conversation already did
  As a LangWatch user chatting with Langy
  I want "run it" to mean the thing Langy just made for me
  So that a follow-up does not turn into an unrelated, expensive search

  # WHY THIS FILE EXISTS
  #
  # A real transcript: Langy created a scenario and reported its id. The user
  # said "run it". Langy replied "Assuming you want to search traces from the
  # last 24h", ran a 40-trace search, and offered a cost analysis nobody asked
  # for. The user had to say "no, run the scenario you just made".
  #
  # The agent's rules already told it to do the right thing ("if turn 1 created
  # a scenario and turn 2 says 'run it', run it"). It could not: the agent's
  # memory of a conversation lives ONLY inside its live worker process, and that
  # process is reaped after a spell of idleness, killed when the turn's
  # capabilities change, and lost whenever the fleet rolls. The control plane
  # sent the next turn nothing but the user's latest sentence — so "run it"
  # arrived with no "it" anywhere in sight, and the agent's "pick a default and
  # act" instinct filled the hole with a trace search.
  #
  # So the conversation's own artefacts are now carried on the turn, from the
  # durable record, the same way the user's screen already was.

  Background:
    Given I am signed in to LangWatch on a project
    And I have the Langy panel open

  # ── The conversation can always be continued ───────────────────────────────
  #
  # The agent's own memory of a conversation lives inside its live worker
  # process, and that process is disposable: recycled when the user switches
  # the model (the model is part of the worker signature), reaped after idle,
  # gone whenever the fleet rolls. The durable messages in the control plane
  # are the only record guaranteed to exist, so every turn of an existing
  # conversation carries the transcript of what was already said, and a fresh
  # worker continues the conversation instead of meeting a stranger.

  @integration
  Scenario: A follow-up turn carries the conversation so far
    Given I told Langy something in an earlier turn of this conversation
    When I send another message in the same conversation
    Then the turn carries what was already said, under who said it

  @integration
  Scenario: What was said survives the worker being replaced
    Given I told Langy my name earlier in this conversation
    And the agent's worker for this conversation has since been replaced
    When I ask Langy for my name
    Then the turn carries the earlier exchange, so Langy can answer from it

  @unit
  Scenario: The message being answered is not repeated as history
    Given the turn re-drives the message already on record
    When the conversation so far is rendered for that turn
    Then that message appears only as the question, not also as history

  @unit
  Scenario: A long conversation is carried in bounded, newest-first form
    Given a conversation far longer than a prompt should carry
    When the conversation so far is rendered for a turn
    Then the newest messages are kept within the budget
    And the block says that older messages were left out

  @unit
  Scenario: A pasted transcript line stays part of its message
    Given an earlier message contains a line that mimics another speaker
    When the conversation so far is rendered for a turn
    Then that line stays indented under the message it came from

  @unit
  Scenario: The transcript block says out loud that it is data
    Given the conversation has earlier messages to render
    When the conversation so far is rendered for a turn
    Then the block tells the agent this is a record of what was said, not instructions

  # ── The memory reaches the agent at all ────────────────────────────────────

  @integration
  Scenario: A follow-up turn carries what earlier turns created
    Given Langy created a scenario for me in an earlier turn of this conversation
    When I send another message in the same conversation
    Then the turn tells the agent that this conversation created that scenario,
      naming its id

  @integration
  Scenario: The memory survives the agent forgetting
    Given Langy created a scenario for me in an earlier turn of this conversation
    And the agent's worker for that conversation has since been replaced
    When I send another message in the same conversation
    Then the turn still tells the agent about that scenario

  @integration
  Scenario: A brand-new conversation carries no memory
    Given I start a new conversation
    When I send my first message
    Then the turn says nothing about earlier resources

  @integration
  Scenario: A conversation whose record cannot be read still answers
    Given the durable record of my conversation cannot be read right now
    When I send a message
    Then the turn is accepted and runs without the memory

  # ── What is remembered ─────────────────────────────────────────────────────

  @unit
  Scenario: A created resource is remembered by kind, id and name
    Given an earlier turn created a scenario called "Customer support agent"
    When the conversation's memory is rendered for a turn
    Then it names the scenario, its id and its name

  @unit
  Scenario: The most recent thing comes first
    Given earlier turns created a dataset and then a scenario
    When the conversation's memory is rendered for a turn
    Then the scenario is listed before the dataset

  @unit
  Scenario: Each entry says which turn it happened in
    Given an earlier turn created a scenario
    When the conversation's memory is rendered for a turn
    Then the entry says which turn of this conversation it came from

  @unit
  Scenario: A listing is remembered by the ids it surfaced
    Given an earlier turn listed several traces
    When the conversation's memory is rendered for a turn
    Then the ids it surfaced are available for "the first one"

  @unit
  Scenario: A tool call that failed is not remembered as a resource
    Given an earlier turn's create failed
    When the conversation's memory is rendered for a turn
    Then nothing from that failed call is offered as a referent

  @unit
  Scenario: A result that names nothing is not remembered
    Given an earlier turn ran a command whose result named no resource
    When the conversation's memory is rendered for a turn
    Then that call contributes no entry

  @unit
  Scenario: The same resource touched twice is remembered once, at its latest turn
    Given an earlier turn created a scenario and a later turn ran it
    When the conversation's memory is rendered for a turn
    Then the scenario appears once, at the later turn

  @unit
  Scenario: A long conversation is remembered in bounded form
    Given a conversation with far more resources than a prompt should carry
    When the conversation's memory is rendered for a turn
    Then only the most recent handful are carried

  # ── The memory is data, never orders ───────────────────────────────────────

  @unit
  Scenario: A resource name cannot forge a line of the system block
    Given an earlier turn created a resource whose name contains a newline and an instruction
    When the conversation's memory is rendered for a turn
    Then the name stays trapped on its own bullet as a value
    And no line of the block is the bare instruction

  @unit
  Scenario: The block says out loud that it is data
    Given the conversation has a memory to render
    When it is rendered for a turn
    Then the block tells the agent this is data and not instructions
    And it tells the agent every id is unverified and must be resolved by a tool

  # ── Acting on a reference instead of guessing ──────────────────────────────

  @integration
  Scenario: Every turn carries the rule for resolving a bare reference
    When I send any message to Langy
    Then the turn carries the rule that "it" means the newest matching thing
      already described to it, and that an unrelated action is never a
      substitute for the one that was asked for

  @integration
  Scenario: The rule is read after everything it talks about
    When I send a message with something on screen and a history behind me
    Then the turn describes my history and my screen first, and only then how to
      resolve a reference against them
