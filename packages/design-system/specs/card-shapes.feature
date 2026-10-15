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
  Scenario: A card can keep the old 20px space and host content that has no title
    Given a card with the lg padding and a card with the default padding
    Then the lg card insets its content further
    And a card given only a description draws it
    And a card with no padding hosts a bounded preview and its footer

  @integration
  Scenario: A card lays its content out as a stack and marks a placeholder
    Given cards with the stack, spaced and flow body layouts
    Then stack and spaced stretch their children in a column with no gap and a 12px gap
    And flow leaves them in block flow
    And a placeholder card draws a dashed border and a plain card does not
    And a tour target lands on the same element as the test id

  @integration
  Scenario: A resource tile accepts only a native opener and keeps its controls reachable
    Given a resource tile whose opener is a div
    Then it refuses the opener
    And a bare button opener never submits an enclosing form
    And a control among the badges takes its own clicks while plain meta falls through

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

  @integration @browser
  Scenario: An editor frame fills its bounded parent without a second scroller
    Given a frame-fill card in a parent of a given height with a neighbour above and below
    When the editor inside it overflows
    Then the card takes the room the neighbours leave, at two parent heights
    And only the editor scrolls, and the card keeps its border and radius

  @integration @browser
  Scenario: A linked card has one native keyboard target and keeps browser navigation
    Given a card with a native link opener and a card with a button opener
    Then the link is one tab stop named by its label or the title, with the caller's href
    And Enter activates it once and a modified click is left to the browser
    And a button opener never submits an enclosing form and its focus ring is not clipped
    And an opener that is not a link or a button, or has no name, is refused

  @integration @browser
  Scenario: Existing cards keep their appearance when the optional capabilities are absent
    Given a panel, nested, frame and showcase card with no opener and no fill
    Then each draws the border, radius, ground and content inset it drew before
    And none carries an opener, a hover response or a focus ring of its own

  @integration @browser
  Scenario: A nested card with a tone is a tinted well and an accent row colours only its edge
    Given nested cards with each tone and accent rows for each role
    Then a toned nested card draws the tone's muted border, subtle fill and foreground heading
    And a neutral nested card draws the plain border and subtle fill, with no tint
    And an accent row draws a 2px left edge in the tone and leaves its fill and fields plain
    And an untoned card draws exactly what it drew before

  @integration
  Scenario: A card names the larger insets and the emphasized variant
    Given cards with padding xl and inline-lg and an emphasized card
    Then xl insets 24px on every side and inline-lg 24px across and 20px down
    And an emphasized card draws the emphasized border, the panel ground and the 2xl radius

  @integration
  Scenario: A toned card is a surface and never an opener
    Given a toned nested card or an accent row given an opener
    Then the card is refused

  @integration
  Scenario: A frame card may be invalid and a joined panel names its edge
    Given a frame card marked invalid and a joined panel with an edge
    Then the invalid border is red with no fill and the panel's inner side is square

  @integration
  Scenario: A nested well takes the xs padding and a muted border
    Given a nested card with padding xs and borderTone muted
    Then it draws an 8px inset and the muted border

  @integration
  Scenario: A banded card, a panel-fill card and an image frame are named variants
    Given a banded card per band tone, a panel-fill card and an image-frame card
    Then each band carries its subtle fill and foreground, the panel fill keeps the panel ground and the image frame is bg.subtle with the lg radius
    And a banded or image-frame card given an opener is refused
