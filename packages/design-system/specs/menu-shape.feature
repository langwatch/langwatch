Feature: Menu shape
  As someone building a LangWatch screen
  I want the shared menu to draw its own affordances
  So that every nested menu in the product shows the same arrow without each caller restyling it

  # The arrow belongs to the shared MenuTriggerItem, not to any one screen, so
  # it is specified here and bound from this package's own browser test.
  @integration @browser
  Scenario: A submenu trigger draws its arrow on the item's right edge
    Given a menu whose items include a submenu trigger
    Then the trigger's arrow is the same size as the arrow on a plain menu item
    And both arrows sit on the same right edge of their item
