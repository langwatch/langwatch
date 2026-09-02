Feature: Langy asks a real question with selectable options
  As someone whose decision Langy is not entitled to make,
  I want the question as a card with real options I can click,
  So that choosing an agent, a prompt, or one of several ways forward
  is one tap with full context — not a prose question and a typed reply.

  # The choices card is the sanctioned UI for the one exception to "never
  # offer options": a decision that spends the customer's money or picks what
  # gets tested belongs to the user. It rides the same relay-stamped
  # channel as derived cards (ADR-060); the SELECTION is both a durable event
  # (the card renders its outcome from the fold, forever) and the next user
  # message (structured part + readable text).
  #
  # The question deliberately ENDS the agent's turn — no new phase states, no
  # parked worker. Answering starts an ordinary next turn.
  #
  # Companion specs:
  #   - specs/langy/langy-derived-cards.feature (the shared inline card channel)
  #   - specs/langy/langy-stop-and-resume.feature (the turn lifecycle, unchanged)
  #
  # ADR: dev/docs/adr/060-langy-model-emitted-blocks.md

  Background:
    Given I am signed in with Langy enabled for a project
    And the Langy panel is open on a conversation

  # ===========================================================================
  # Ask, settle, answer — the turn lifecycle is untouched
  # ===========================================================================

  Scenario: A question card ends the turn and waits
    Given Langy's reply ends with a choices card
    When the turn settles
    Then the options render as a selectable card
    And the panel is idle — no spinner, no in-flight turn

  Scenario: Selecting an option answers as the next message
    Given an open question card with options
    When I select one
    Then my choice appears as my own message in the conversation
    And a new turn starts with Langy acting on it

  Scenario: The reply binds to its exact question
    Given two question cards exist earlier in the conversation
    When I answer the open one
    Then the reply references that question's own identity
    And it can never be attributed to the other question

  Scenario: The agent reads the choice as plain words
    Given I selected the option labeled for the staging agent
    When the next turn begins
    Then Langy's context carries a readable statement of what was chosen
    And Langy acts on the selection without asking again

  # ===========================================================================
  # Options grounded in the platform
  # ===========================================================================

  Scenario: Options naming real entities render as live rows
    Given a question whose options reference existing agents by id
    When the card renders
    Then each option carries the entity's current name and vital detail
    And the rows are resolved with my own permissions

  # An option's label is the answer, not a name for the thing it points at.
  # "Publish the winning draft" grounded in the prompt it would publish read as
  # that prompt's own name and version, so the closing question of a whole
  # optimization run looked like a list of two unrelated resources.
  @integration
  Scenario: A grounded option still reads as the answer it is
    Given an option labeled with an action and referencing the resource it acts on
    When the card renders
    Then the row reads as the option's own label
    And the resource's current name reads under it as detail

  Scenario: A dead reference cannot be selected
    Given an option referencing an entity that no longer exists
    When the card renders
    Then that option is disabled and says the thing is gone
    And selecting it is impossible rather than failing later

  Scenario: Arbitrary options need no references at all
    Given a question with six plain label-and-description options
    When the card renders
    Then all six are selectable as given

  Scenario: Other lets me answer outside the list
    Given a question card that allows a free-text answer
    When I choose Other and type my own
    Then my text answers the question like any option would

  # ===========================================================================
  # The answer is an event — rendered from the fold, replayed by time travel
  # ===========================================================================

  Scenario: An answered question shows its outcome forever
    Given a question I answered yesterday
    When the conversation is reloaded
    Then the card renders locked with my choice marked
    And the options are no longer clickable

  Scenario: Time travel shows the question open before the answer and closed after
    Given a settled conversation containing an answered question
    When I scrub the inspector to before my selection
    Then the card renders as it was — open and awaiting
    When I scrub past my selection
    Then the card renders locked with the choice marked

  # ===========================================================================
  # Asked mid-task, the card answers the tool
  # ===========================================================================

  # While Langy changes the customer's code it sometimes reaches a fork that
  # is the user's to pick: which file owns the setup, which account to use,
  # whether to open the pull request now. Ending the turn there would throw
  # away the plan Langy is in the middle of. So the worker's question tool
  # waits for the answer while the turn is in flight, through the same user
  # wait the permission card uses (specs/langy/langy-local-permissions.feature).
  # The card is the same choices card; only the delivery of the answer differs.
  # Langy decides routine things itself and asks only when two ways forward
  # differ for the user. See dev/docs/adr/129-langy-local-control.md.

  Rule: A question asked mid-task keeps the turn and returns the answer to the tool

    @unit
    Scenario: The worker has a question tool
      When a worker is provisioned
      Then it has a question tool that takes a question, a header, options with labels and descriptions, and whether several may be picked
      And its description says to decide routine things alone and to ask only when the ways forward differ for the user

    @integration
    Scenario: A question asked by the tool renders while the turn is in flight
      Given Langy is in the middle of a change
      When Langy asks which file should own the tracing setup
      Then the choices card renders with the options
      And the turn stays in flight, with the tool waiting

    @integration
    Scenario: Selecting an option returns it to the tool and the turn continues
      Given an open question card asked by the tool
      When I select an option
      Then the tool receives my selection as its result
      And Langy continues the same turn with the plan it had
      And the card renders locked with my choice marked

    @integration
    Scenario: A free-text answer reaches the tool as words
      Given an open question card asked by the tool that allows a free-text answer
      When I choose Other and type my own
      Then the tool receives my text as its result

    @integration
    Scenario: A question no one answers ends the turn in words
      Given an open question card asked by the tool
      When the wait passes its budget
      Then the tool result reads that no answer arrived
      And Langy ends the turn saying what it is waiting for
      And the card stays open

    @integration
    Scenario: A late answer starts the next turn as my message
      Given a question card whose tool wait already ended the turn
      When I select an option
      Then my choice appears as my own message in the conversation
      And a new turn starts with Langy acting on it

    @integration
    Scenario: Stopping the turn closes the open question
      Given an open question card asked by the tool
      When I stop the turn
      Then the card renders superseded
      And the tool wait ends

    @e2e
    Scenario: Langy asks a real fork while changing code and continues after the answer
      Given my local folder is connected and Langy is instrumenting tracing
      When Langy reaches a choice between two files that could own the setup
      Then Langy asks it as a question card, not as prose
      And after my answer Langy edits the file I picked in the same turn
      And the judge confirms Langy asked nothing it could have decided alone

  # ===========================================================================
  # Staleness is event order, nothing else
  # ===========================================================================

  Scenario: Moving on locks the question
    Given an open question card
    When I type an ordinary message instead of answering
    Then the question renders superseded and cannot be answered
    And no timer was involved — only the order of what happened

  Scenario: A superseded question stays readable
    Given a question that was superseded without an answer
    When I scroll back to it
    Then I can still read the question and its options
    And it is visibly closed rather than removed
