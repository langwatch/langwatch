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

  # The secret snippet card shows a value once: it leans in while the value
  # is on screen, and settles to a quiet masked receipt once it is gone.
  # See specs/langy/langy-secret-snippet.feature.
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

  # A failed tool call is part of how an agent works, not an alarm: it folds into
  # the record of the work with the calls that worked, like a terminal agent's log.
  # Red stays in the conversation only where the person has to act on it.
  @integration
  Scenario: A failed step folds into the record of the work
    Given a step that failed and a reply Langy wrote after it
    When I read the finished turn
    Then that failure is no card of its own in the conversation
    And it is a row in the folded record of the work, among the steps that worked
    And the row reads like a step that worked, tagged "failed", never that Langy carried on
    And opening the row shows the command and its error text, as a step that worked shows its result
    And the error's code and its trace, logs and docs links show there when it has them

  @integration
  Scenario: A step that fails while the turn is running folds into the record too
    Given a step that failed while Langy is still working
    When I watch the turn
    Then that failure is one quiet line tagged "failed", not a card
    And it stays in view until the next step starts
    And then it folds into the record of the work

  @integration
  Scenario: The record of the work counts its failures quietly
    Given two steps that worked and three that failed
    When I read the record of the work
    Then its header says "2 actions completed" and "5 tool calls, 3 failed" in a quiet grey
    And when every step failed it says "3 actions failed" with a grey mark, not the green check
    And a step that worked or failed still counts while it stands beside the record as the latest step
    And nothing in the header is red

  @integration
  Scenario: Only the last failed step of an unanswered turn keeps its card
    Given a turn that ended on a failed step, with no reply after it
    When I read the finished turn
    Then the failure the turn ended on keeps its card
    And a failure followed by steps that worked stays folded in the record of the work

  # Known limit: the stop is not stored on the message, so after a follow-up
  # message or a reload the stopped turn reads as unanswered again.
  @integration
  Scenario: A stopped turn keeps its failures folded while it is the latest turn
    Given a turn I stopped right after a step failed, still the latest turn in this session
    When I read the turn
    Then that failure stays folded in the record of the work

  @integration
  Scenario: A receipt the reader only passes over still closes
    Given the record of the work is open
    When a pointer only passes over it
    Then it closes shortly after the pointer leaves
    And when I click or focus into it, it stays open

  # Known limit: a local tool's plain-text login error with a non-zero exit is not yet read as a failure.
  @integration
  Scenario: A failure no retry can fix keeps its card
    Given a step refused because access was refused or GitHub is not connected, or a local tool whose tool error or JSON error document says it is not logged in
    When I read the turn, while it runs or after it answered
    Then that failure keeps its card in the conversation

  # Known limit: the sandbox CLI's plain-text login error carries no code, so it takes the
  # plain-failure path and, as the last step, keeps the generic card.
  @integration
  Scenario: A sandbox credential failure folds into the record
    Given a step whose JSON error document carries a credential code for Langy's own sandbox credential, and a reply after it
    When I read the turn, while it runs or after it answered
    Then that failure is a row in the folded record of the work, not a card
    And opening it says the failure is on Langy's side, not the reader's access

  @integration
  Scenario: A refused access keeps its card even when a retry might work
    Given a step refused with an access-denial code that is not marked final
    When I read the turn after it answered
    Then that failure keeps its card in the conversation

  @integration
  Scenario: A not-found probe folds into the record
    Given a step that looked for something that does not exist, and a reply after it
    When I read the turn, while it runs or after it answered
    Then that failure is a row in the folded record of the work, not a card

  @integration
  Scenario: A step the person denied keeps its card
    Given a step the person was asked to allow and denied
    When I read the turn, while it runs or after it answered
    Then that step keeps its card in the conversation

  @integration
  Scenario: A failure the person can act on keeps its card
    Given a step refused because the plan is out of room, or a Slack automation with no connection
    When I read the turn, while it runs or after it answered
    Then the card that lets me act stays in the conversation
