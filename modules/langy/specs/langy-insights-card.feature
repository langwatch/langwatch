Feature: The insights card
  Langy may hand back what it found on a board as one card of findings. The card is one of
  the closed list's presentation kinds: Langy writes it as a fenced langy-card block in its
  reply, the relay validates it and stamps it as a typed part, and the panel draws the part.
  No command produces it, so writing one needs no permission at all. Any module that reads
  a settled turn takes the findings from the stamped part and never from the prose.

  # ADR: dev/docs/adr/060-langy-model-emitted-blocks.md, 079-card-selection-is-deterministic.md
  # The skill that teaches the card: modules/langy/specs/langy-daily-insights-skill.feature
  # The run that reads the card: modules/insight/specs/insight-daily-run.feature

  Rule: The insights card is one of the closed list's kinds, chosen by its kind alone

    @unit
    Scenario: The insights card is a presentation kind Langy may write
      Given Langy's closed list of card kinds
      When the list is read
      Then insights is a presentation kind on the list a model may emit
      And it is no kind a command's result is stamped with

    @unit
    Scenario: No command's result is promoted to an insights card
      Given the shape probes that promote a command's result to a richer card
      When the probes are read
      Then none promotes to the insights card

    @unit
    Scenario: A finding holds its words, its verdict, its widget, its query, its key and what it renews
      Given a card with a title, a board, a window and a finding that holds every field
      When the card is validated
      Then it is accepted and its words are kept trimmed

    @unit
    Scenario: A finding may propose up to four actions for the insight saved from it
      Given a finding with actions, each a label and a prompt
      When the card is validated
      Then it is accepted with four actions, and refused with five or with a label past 40 characters

    @unit
    Scenario: An insights card with no findings says nothing is worth reporting
      Given a card whose list of findings is empty
      When the card is validated
      Then it is accepted

    @unit
    Scenario: A payload that is not genuinely an insights card is no insights card
      Given a payload with no findings list, a finding with no title, an unknown tone or no block id
      When the payload is validated
      Then it is refused

    @unit
    Scenario: A card that names anything a finding may not hold is refused whole
      Given a card whose finding names an owner, a project or a board of its own
      When the card is validated
      Then the whole card is refused
      And a card that names an owner beside its findings is refused too

    @unit
    Scenario: A fenced insights card is stamped only when it validates
      Given a well-formed fenced insights card and one whose finding holds a key the card does not list
      When the relay reads each
      Then the first is stamped as an insights card
      And the second is no card

    # A stream that stops mid-card is repaired, as every card is. The part says so, and a
    # reader that files what it reads refuses a repaired card.
    @unit
    Scenario: A card repaired from damaged JSON says so on its part
      Given a fenced insights card cut off inside a finding's body
      When the relay stamps what the repair left of it
      Then the part is marked as repaired
      And a card whose JSON was whole is not

    @unit
    Scenario: A reader takes an answer's findings from its stamped card
      Given the parts of a settled answer: prose, two insights cards, another card and a failed card
      When the insights cards are read from the parts
      Then both are handed back in the answer's own order
      And prose that only quotes a card hands back none

  Rule: The panel draws the card

    @integration
    Scenario: The panel draws one row per finding with its verdict, title and body
      Given a recorded answer whose parts hold prose and an insights card with two findings
      When the panel draws the answer
      Then the card sits in the derived frame with one row per finding
      And each row reads its verdict in words, its topic, its title and its body

    @integration
    Scenario: An insights card with no findings reads as nothing new
      Given a recorded answer whose insights card holds no finding
      When the panel draws the answer
      Then the card says nothing is new to report

    @integration
    Scenario: A long list of findings stays a card
      Given a recorded answer whose insights card holds 13 findings
      When the panel draws the answer
      Then the first 10 are drawn and the card says 3 more are in the reply

    @integration
    Scenario: An answer's insights card is handed to the actions under it
      Given a settled answer that carries an insights card
      When the actions under the answer are drawn
      Then each is handed the card as typed data
      And an answer with no card, or one still streaming, hands none
