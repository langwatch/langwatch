Feature: A derived stats card reads as a comparison, at any panel width
  As someone reading Langy's report on a prompt optimization run,
  I want the figures drawn so the winner is obvious and nothing runs off the panel,
  So that the answer to "did it get better" is visible before I read a number.

  # The stats card carries readings the model wrote, so both the unit and the
  # item count are free text and free choice. The unit reaches the card as a
  # word ("percent") where the body appends it to the number, and the figures
  # sit in one row that a narrow panel cannot hold. Both are decided here, at
  # the presentation boundary, not trusted from the model.
  #
  # Companion specs:
  #   - specs/langy/langy-derived-cards.feature (how a fence becomes a card)
  #   - specs/langy/langy-prompt-optimization-loop.feature (what the report says)

  @unit
  Scenario: A unit word is drawn as the symbol a reader expects
    Given a stats item whose unit is the word percent
    When the figure is drawn
    Then it reads as the number followed by a percent sign
    And no space separates them

  @unit
  Scenario: A unit that is a word stands off the number
    Given a stats item whose unit is a word with no symbol, such as tokens
    When the figure is drawn
    Then a space separates the number from the unit

  @unit
  Scenario: A unit that is already a symbol is left alone
    Given a stats item whose unit is a symbol
    When the figure is drawn
    Then the symbol is drawn as written, with no space before it

  @unit
  Scenario: Readings on one scale are a comparison
    Given two or more numeric stats items sharing one unit
    When the card decides how to draw them
    Then it draws them as a bar comparison

  @unit
  Scenario: Readings that share no scale are not a comparison
    Given stats items whose units differ, or that are not all numeric
    When the card decides how to draw them
    Then it does not draw them as a bar comparison

  @unit
  Scenario: A single reading is not a comparison
    Given one numeric stats item
    When the card decides how to draw them
    Then it does not draw it as a bar comparison

  @integration
  Scenario: The bar comparison marks the leading reading
    Given a stats card comparing a baseline reading against a higher candidate
    When the card renders
    Then every reading has a bar sized against the largest of them
    And the leading reading is the one marked as best

  @integration
  Scenario: The figure row wraps rather than leaving the panel
    Given a stats card with more readings than the panel width fits
    When the card renders
    Then the readings wrap onto further lines
    And no reading is cut off by the panel edge
