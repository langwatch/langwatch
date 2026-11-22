Feature: Emoji picker
  As someone naming a workflow or an agent
  I want to choose its icon from a short list or type any emoji
  So that I can tell my workflows and agents apart at a glance

  @integration
  Scenario: Picking an emoji from the grid sets the icon and closes the picker
    Given the picker shows the current icon
    When I open it and pick an emoji from the grid
    Then that emoji becomes the icon
    And the picker closes

  @integration
  Scenario: Typing an emoji and pressing Enter sets the icon
    Given the picker is open
    When I type an emoji that is not in the grid and press Enter
    Then that emoji becomes the icon
