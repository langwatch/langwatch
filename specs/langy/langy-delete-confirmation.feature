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
    And a card asks the person "Delete evaluator "Toxicity check" (…city)?" with the options Yes and No
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
  Scenario: A request naming more than ten items is refused with no card
    When Langy deletes eleven rows in one request
    Then the request is refused with langy_confirmation_required
    And the message asks Langy to do it in batches of ten
    And no card is shown

  @unit
  Scenario: A delete of an item that does not exist shows no card
    When Langy deletes an evaluator that does not exist
    Then the request reaches the route's own answer for a missing item
    And no card is shown

  @integration
  Scenario: A route the project cannot reach refuses a Langy key before any card
    Given a delete route that is not there for the key's project, as a feature switched off
    When Langy deletes through it
    Then the route's own refusal is the answer
    And no card is shown and no item name is read

  @unit
  Scenario: The card reads the item through the path the delete acts on
    Given an item reached through a parent named in the path
    When Langy deletes it through a parent that does not hold it
    Then no card is shown
    And the delete answers that the item is not found

  @unit
  Scenario: The card names the item on one short line
    Given an evaluator whose name runs over many lines and characters
    When Langy deletes it
    Then the card shows the name on one line, cut to 80 characters, with the end of its id

  @integration
  Scenario: Two requests at once show one card
    When Langy deletes the evaluator twice at the same moment
    Then both are refused with langy_confirmation_required
    And only one card is shown

  @unit
  Scenario: A click that another request spent first asks Langy to run again
    Given the person clicked Yes on the card for the evaluator
    And another request spends that click first
    When Langy deletes the evaluator
    Then the request is refused with langy_confirmation_required
    And the message tells Langy to run the same command again

  @unit
  Scenario: A Langy key needs the click on every door that lets a key in
    When Langy deletes a virtual key through the gateway's key door
    Then the request is refused with langy_confirmation_required
    And a card is asked for in the project the Langy key belongs to

  @unit
  Scenario: Rotating stays withheld from Langy
    When Langy rotates a virtual key
    Then the request is refused because Langy is never given that permission
    And no card is shown

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
    Then every write route declares the confirmation mark, says why it asks for none, or says it keeps every record
    And a write route that declares none of these stops the build, whatever its audit is named
    And a DELETE route cannot say it keeps every record
    And an update that can switch a record off asks for the click when its body would do so
    And every route that says it asks for none is one a Langy key cannot reach

  @regression @unit
  Scenario: A Langy key's delete card names the key owner's own Only me records
    Given a dashboard record on a board only the key's owner can see
    When Langy deletes or removes that record
    Then the card names the record, as the delete reads it for the key's owner
    And for a key that names nobody, or names another member, the record reads as not found
