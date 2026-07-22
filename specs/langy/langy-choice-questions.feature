Feature: Langy asks a real question with selectable options
  As someone whose decision Langy is not entitled to make,
  I want the question as a card with real options I can click,
  So that choosing an agent, a prompt, or one of several ways forward
  is one tap with full context — not a prose question and a typed reply.

  # The choices block is the sanctioned UI for the one exception to "never
  # offer options": a decision that spends the customer's money or picks what
  # gets tested belongs to the user. The block rides the same relay-stamped
  # channel as derived cards (ADR-060); the SELECTION is both a durable event
  # (the card renders its outcome from the fold, forever) and the next user
  # message (structured part + readable text).
  #
  # The question deliberately ENDS the agent's turn — no new phase states, no
  # parked worker. Answering starts an ordinary next turn.
  #
  # Companion specs:
  #   - specs/langy/langy-derived-cards.feature (the shared block channel)
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
    Given Langy's reply ends with a choices block
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
    Then each option shows the entity's current name and vital detail
    And the rows are resolved with my own permissions

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
