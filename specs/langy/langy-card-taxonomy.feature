Feature: Langy's cards read at the right attention weight
  As someone reading a conversation with Langy,
  I want each card to take exactly as much of my attention as it deserves,
  so that a small piece of work never shouts and a decision never hides.

  # Every card Langy renders is one of five INTENTS, ordered by attention weight.
  # The intent — not the component — fixes the material: sizing, surface, border,
  # whether the one warm amber accent is spent, and the status-dot tone. The
  # system lives in one place (asaplangy CARD_TAXONOMY) and is rendered by one
  # primitive (LangyCard), so a card's weight is a single data decision rather
  # than a per-component re-invention. The governing rule: warmth is earned —
  # only the two heaviest intents (a decision, a headline result) spend the amber
  # accent, so a wall of receipts never reads as noise.
  #
  # The five intents, quietest to loudest:
  #   activity  — a small piece of work is happening (an inline line, no box)
  #   progress  — the thing you asked for is under way (a live receipt)
  #   change    — something was created, updated, or removed (a settled receipt)
  #   ask       — Langy needs a decision from you (leans in, an action row)
  #   spotlight — something worth your full attention (the panel material)

  Scenario: A small piece of work stays inline and quiet
    Given Langy is doing a small piece of work
    When it shows an activity card
    Then the card reads as an inline status line rather than a box
    And it does not spend the warm accent

  Scenario: Progress on my request reads as a live receipt
    Given Langy is working on the thing I asked for
    When it shows a progress card
    Then the card reads as a quiet hairline receipt
    And a live status dot shows while the work runs
    And it does not spend the warm accent

  Scenario: A change that landed names its outcome
    Given Langy created, updated, or removed something
    When it shows a change card
    Then the card reads as a settled hairline receipt
    And a status dot names the outcome

  Scenario: A decision leans in and offers an action
    Given Langy needs a decision from me
    When it shows an ask card
    Then the card leans in with the warm accent
    And it offers a clear action to respond with

  Scenario: A headline result takes full attention
    Given Langy is showing me something worth my full attention
    When it shows a spotlight card
    Then the card carries the full panel material
    And its title is set in the display serif

  Scenario: Warmth is earned
    When Langy renders cards across the five intents
    Then only the decision and the headline result carry the warm accent
    And the lower-weight receipts stay on the quiet neutral hairline

  Scenario: An error is a calm receipt, not an alarm
    Given a step Langy ran could not be completed
    When it shows the error
    Then the error reads as a calm change-weight card in Langy's own skin
    And the trouble is carried by a calm rust tone, not a loud alert box
    And the retry is offered as a clear action
