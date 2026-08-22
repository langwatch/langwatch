Feature: Prompt playground surface hierarchy
  As someone working on a prompt
  I want the playground's panes, bars and lists to read as a deliberate hierarchy
  So that I can tell at a glance what I have selected and where one surface ends

  # The playground stacks three surfaces: the page ground the prompts rail sits
  # on, the card that holds one prompt (its tab strip, editor and conversation),
  # and the bars and wells inside that card. The scenarios below pin the two
  # rules a user can actually act on: which row the list marks, and which
  # element draws the rule the selected sub-tab sits on.

  Background:
    Given I am authenticated in project "my-project"

  # Each surface owns the actions that belong to it. The rail is the surface
  # that enumerates the project's prompts, so adding one is the rail's action.
  # It used to sit in the tab strip on the opposite edge of the screen, which
  # asked the user to cross the whole workspace to add a row to a list on the
  # left. The strip keeps only what acts on the prompts already open there.

  @integration
  Scenario: Adding a prompt is offered by the list of prompts
    When I open the playground
    Then the prompts rail offers to start a new prompt, beside its heading

  @unit
  Scenario: The prompts list marks the prompt the workspace is showing
    Given "search-agent" and "summariser" are open in the playground
    And "summariser" is the tab on screen
    Then the prompts list marks "summariser" as selected
    And the prompts list does not mark "search-agent" as selected

  @unit
  Scenario: The prompts list marks nothing when no prompt is open
    Given no prompts are open in the playground
    Then the prompts list marks no row as selected

  @unit
  Scenario: The prompts list follows the pane the user is working in
    Given the playground is split with "search-agent" in the left pane and "summariser" in the right
    And the right pane is the one I am working in
    Then the prompts list marks "summariser" as selected

  @integration
  Scenario: The sub-tab bar closes with a hairline in both layouts
    When I view a prompt in the playground
    Then the Conversation / Variables / Parameters bar draws a rule along its bottom
    And it draws that rule whether the panes sit side by side or stacked

  @integration
  Scenario: The tab of the prompt on screen is attached to the card it opens
    When I view a prompt in the playground
    Then its tab sits on the page above the card rather than inside it
    And no rule runs between that tab and the prompt below it

  @integration
  Scenario: The drag divider sits above the sub-tab bar when the panes are stacked
    When I view a prompt with the editor stacked above the conversation
    Then the handle that resizes the prompt sits between the prompt and the tab bar
