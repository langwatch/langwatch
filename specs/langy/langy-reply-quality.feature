Feature: Langy reply quality
  Langy's reply matches the question: a finding for a read, one forward-looking
  line for a write, a friendly line for a greeting, a one-line decline for an
  out-of-scope ask. A turn never ends with nothing visible: the cards carry the
  data, the prose carries what only prose can say, and an empty reply reads as
  a broken product even when every action succeeded.

  Background:
    Given a project with traces and a working Langy session

  @unit
  Scenario: A turn never ends silently
    Given Langy ran its commands and produced cards but wrote no prose
    When the turn reaches its end
    Then the panel still shows one visible line of text
    And that line says the turn produced no answer and points at the cards, so a
      turn that completed a write is not repeated blindly

  @unit
  Scenario: A stream that ends without the turn finishing says nothing
    Given the user stops the turn, or the worker checkpoints and hands it off
    When the live stream ends
    Then no line claims the turn finished without writing a reply
    And a partial answer already on screen is left as it is, since a stop
      usually lands on one and a handoff is re-driven on a fresh worker

  @unit
  Scenario: The card shapes the prompt teaches are shapes the panel renders
    Given the derived-card examples written in Langy's prompt
    When each one is checked against the card contract
    Then every kind the model may emit has an example
    And each example validates, so following the prompt cannot produce a
      card that degrades to the failed-card disclosure

  @e2e
  Scenario: A completed write ends with a visible next-step line
    When the user asks Langy to create a dataset
    Then the dataset exists afterwards
    And the reply contains at least one visible line of text
    And that line points at what to do next or states the change plainly
    And the reply does not recite the ids and fields the card already shows

  @e2e
  Scenario: A bare acknowledgment gets a visible reply, not silence
    Given Langy answered a question in the previous turn
    When the user says only "thanks!"
    Then Langy replies with one short friendly line
    And the reply is not empty
    And no new work starts that the user did not ask for

  @e2e
  Scenario: An out-of-scope request is declined in one line
    When the user asks for an infrastructure runbook unrelated to LangWatch
    Then Langy declines in a single short line
    And no part of the runbook is produced, under any framing
    And no command for outside infrastructure runs
