Feature: Card, resource tile, load more and the one-line empty state
  As someone building a LangWatch screen
  I want one card with a fixed set of looks and the list pieces around it
  So that surfaces and list endings read the same on every page
  Rulings: packages/design-system/adrs/002-overlay-and-card-shapes.md

  @integration
  Scenario: A section card draws its header slots, body and footer
    Given a card with a title, a status, a badge, actions and a footer
    Then the title is a heading with the status dot beside the badge words
    And the footer sits under the body

  @integration
  Scenario: A card takes only the named looks
    Given a card for each variant and padding
    Then each card says which look and padding it drew
    And the governance and gateway look is the showcase variant

  @integration
  Scenario: The old settings card delegates to the card
    Given a settings card with a hint, a tone and actions
    Then it draws a card with the hint as its description and the actions as its footer

  @integration
  Scenario: A resource tile opens from its own link while its menu stays usable
    Given a resource tile with a native opener and a menu
    Then the opener is named by the tile's title
    And the menu is a separate control above the opener

  @integration
  Scenario: An appending list shows how far it has loaded
    Given a list that has loaded 50 of 212 runs
    Then it says so and offers Load more
    When the list reaches its end
    Then the button goes and the count stays

  @integration
  Scenario: An empty picker says so in one line
    Given a picker with nothing to show
    Then one muted sentence and its one action replace the list
