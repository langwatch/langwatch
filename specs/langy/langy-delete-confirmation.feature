Feature: Removing something with Langy needs a confirmation click

  When Langy asks to remove or disable something in a project, the platform
  runs the request only after the person clicked Yes on a confirmation card
  for that exact item, in the same conversation, and that click was not
  used before. A typed "yes" never counts: only the card's own Yes button
  does. Every other credential keeps working exactly as before.

  Background:
    Given a conversation whose Langy key is bound to it
    And an evaluator named "Toxicity check"

  @integration
  Scenario: A delete with no click is refused and a card is shown
    When Langy deletes the evaluator
    Then the request is refused with langy_confirmation_required
    And the message tells Langy a confirmation card for evaluator "Toxicity check" is shown
    And a card asks the person "Delete evaluator "Toxicity check"?" with the options Yes and No
    And the evaluator still exists

  @integration
  Scenario: A click on Yes lets the same delete run once
    Given the person clicked Yes on the card for the evaluator
    When Langy deletes the evaluator
    Then the evaluator is deleted

  @integration
  Scenario: One click covers one request
    Given the person clicked Yes on the card for the evaluator
    When Langy deletes the evaluator twice
    Then the first delete runs
    And the second is refused with langy_confirmation_required

  @integration
  Scenario: A click on another item does not cover this one
    Given the person clicked Yes on the card for a different evaluator
    When Langy deletes the evaluator
    Then the request is refused with langy_confirmation_required

  @integration
  Scenario: A click on No never lets the delete run
    Given the person clicked No on the card for the evaluator
    When Langy deletes the evaluator
    Then the request is refused with langy_confirmation_required

  @unit
  Scenario: A typed yes is not a click
    Given a card is waiting for the evaluator
    When the person types "yes" as a message
    And Langy deletes the evaluator
    Then the request is refused with langy_confirmation_required

  @unit
  Scenario: A click for a delete does not cover a disable
    Given the person clicked Yes on the card to delete the evaluator
    When Langy disables the evaluator
    Then the request is refused with langy_confirmation_required

  @integration
  Scenario: A bulk delete needs a click for every item
    Given the person clicked Yes for one of two rows
    When Langy deletes both rows in one request
    Then the request is refused with langy_confirmation_required
    And the click for the first row is still unspent

  @unit
  Scenario: A key that belongs to no conversation is refused
    Given a Langy key with no conversation bound to it
    When Langy deletes the evaluator
    Then the request is refused with langy_confirmation_required

  @unit
  Scenario: Other keys are not asked for a click
    When a person's own API key deletes the evaluator
    Then the evaluator is deleted
    And no card is shown

  @unit
  Scenario: A waiting card is not shown twice
    Given a card is waiting for the evaluator
    When Langy deletes the evaluator again, in this turn or the next
    Then the request is refused with langy_confirmation_required
    And no second card is shown

  @unit
  Scenario: A click after the turn ended still counts in the next turn
    Given the turn that showed the card has ended
    When the person clicks Yes on the card
    Then the card is still answerable
    And Langy's next turn, with a new key in the same conversation, deletes the evaluator

  @unit
  Scenario: A click on a card that stopped waiting is sent as a message and still counts
    Given the card is no longer waiting
    When the person's click arrives as the message "Chose: Yes"
    Then the click counts for the evaluator

  @unit
  Scenario: Every route that removes or disables something asks for the click
    When the registered routes are listed
    Then every route a Langy key can reach that deletes, archives, removes or disables declares the confirmation mark or says why it does not
