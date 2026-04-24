Feature: Template logic autocomplete in prompt textarea
  As a prompt author
  I want an autocomplete popup for Liquid template logic constructs
  So that I can quickly insert conditional and iteration blocks without memorizing syntax

  Background:
    Given a prompt textarea is rendered with variables "input" and "context"

  # ============================================================================
  # Opening the menu via {% trigger
  # ============================================================================

  @integration @unimplemented
  Scenario: Typing {% opens the logic autocomplete popup
    Given the textarea is focused
    When I type "Hello {%"
    Then the logic autocomplete popup appears
    And it shows template logic constructs

  @integration @unimplemented
  Scenario: Typing { alone does not open logic popup
    Given the textarea is focused
    When I type "Hello {"
    Then the logic autocomplete popup does not appear

  @integration @unimplemented
  Scenario: Typing {% at start of empty textarea
    Given the textarea is empty and focused
    When I type "{%"
    Then the logic autocomplete popup appears

  # ============================================================================
  # Popup content - available constructs
  # ============================================================================

  @integration @unimplemented
  Scenario: Popup shows all template logic constructs
    Given the logic autocomplete popup is open
    Then I see the following constructs:
      | label   |
      | if      |
      | for     |
      | assign  |
      | unless  |
      | elsif   |
      | else    |
      | comment |

  @integration @unimplemented
  Scenario: Each construct shows a description
    Given the logic autocomplete popup is open
    Then the "if" construct shows a description of its purpose
    And the "for" construct shows a description of its purpose

  @integration @unimplemented
  Scenario: Popup footer contains a docs link
    Given the logic autocomplete popup is open
    Then I see a link to the Liquid template syntax documentation in the popup footer

  # ============================================================================
  # Filtering constructs by typing
  # ============================================================================

  @integration @unimplemented
  Scenario: Typing after {% filters the constructs list
    Given the textarea is focused
    When I type "{% if"
    Then the popup shows only constructs matching "if"
    And I see "if" in the list
    And I do not see "for" in the list

  @integration @unimplemented
  Scenario: Typing partial match filters correctly
    Given the textarea is focused
    When I type "{% a"
    Then I see "assign" in the list
    And I do not see "for" in the list

  @integration @unimplemented
  Scenario: Filter with no matches shows empty state
    Given the textarea is focused
    When I type "{% xyz"
    Then the popup shows a "No matching constructs" message

  @integration @unimplemented
  Scenario: Filter is case-insensitive
    Given the textarea is focused
    When I type "{% IF"
    Then I see "if" in the list

  # ============================================================================
  # Selecting a construct inserts full block template
  # ============================================================================

  @integration @unimplemented
  Scenario: Selecting "if" inserts if/endif block
    Given the textarea contains "Hello " and the logic popup is open
    When I select the "if" construct
    Then the textarea contains "Hello {% if  %}{% endif %}"
    And the cursor is positioned between "if " and " %}"
    And the popup closes

  @integration @unimplemented
  Scenario: Selecting "for" inserts for/endfor block
    Given the textarea is empty and the logic popup is open
    When I select the "for" construct
    Then the textarea contains "{% for  %}{% endfor %}"
    And the cursor is positioned between "for " and " %}"

  @integration @unimplemented
  Scenario: Selecting "assign" inserts assign tag
    Given the textarea is empty and the logic popup is open
    When I select the "assign" construct
    Then the textarea contains "{% assign  %}"
    And the cursor is positioned between "assign " and " %}"

  @integration @unimplemented
  Scenario: Selecting "unless" inserts unless/endunless block
    Given the textarea is empty and the logic popup is open
    When I select the "unless" construct
    Then the textarea contains "{% unless  %}{% endunless %}"
    And the cursor is positioned between "unless " and " %}"

  @integration @unimplemented
  Scenario: Selecting "comment" inserts comment/endcomment block
    Given the textarea is empty and the logic popup is open
    When I select the "comment" construct
    Then the textarea contains "{% comment %}{% endcomment %}"

  @integration @unimplemented
  Scenario: Selecting "elsif" inserts inline elsif tag
    Given the textarea is empty and the logic popup is open
    When I select the "elsif" construct
    Then the textarea contains "{% elsif  %}"
    And the cursor is positioned between "elsif " and " %}"

  @integration @unimplemented
  Scenario: Selecting "else" inserts inline else tag
    Given the textarea is empty and the logic popup is open
    When I select the "else" construct
    Then the textarea contains "{% else %}"

  @integration @unimplemented
  Scenario: Typed filter text is replaced by selected construct
    Given the textarea is focused
    And I have typed "{% fo"
    When I select the "for" construct
    Then the textarea contains "{% for  %}{% endfor %}"
    And the partial "{% fo" text is no longer present

  # ============================================================================
  # "Add logic" button
  # ============================================================================

  @integration @unimplemented
  Scenario: "Add logic" button appears next to "Add variable" button on hover
    Given the textarea is not focused
    When I hover over the textarea
    Then I see an "Add logic" button
    And I see an "Add variable" button
    And both buttons are visible in the bottom area of the textarea

  @integration @unimplemented
  Scenario: Clicking "Add logic" opens the logic autocomplete popup
    When I click the "Add logic" button
    Then the logic autocomplete popup appears
    And it shows all template logic constructs

  @integration @unimplemented
  Scenario: "Add logic" inserts at end of textarea content
    Given the textarea contains "Hello world"
    When I click the "Add logic" button
    And I select the "if" construct
    Then the textarea contains "Hello world{% if  %}{% endif %}"

  @integration @unimplemented
  Scenario: "Add logic" button hidden when textarea is disabled
    Given the textarea is disabled
    When I hover over the textarea
    Then the "Add logic" button is not visible

  # ============================================================================
  # Keyboard navigation
  # ============================================================================

  @integration @unimplemented
  Scenario: ArrowDown moves highlight to next construct
    Given the logic autocomplete popup is open
    And the first construct is highlighted
    When I press ArrowDown
    Then the second construct is highlighted

  @integration @unimplemented
  Scenario: ArrowUp moves highlight to previous construct
    Given the logic autocomplete popup is open
    And the second construct is highlighted
    When I press ArrowUp
    Then the first construct is highlighted

  @integration @unimplemented
  Scenario: ArrowUp at first item does not wrap
    Given the logic autocomplete popup is open
    And the first construct is highlighted
    When I press ArrowUp
    Then the first construct remains highlighted

  @integration @unimplemented
  Scenario: ArrowDown at last item does not wrap
    Given the logic autocomplete popup is open
    And the last construct is highlighted
    When I press ArrowDown
    Then the last construct remains highlighted

  @integration @unimplemented
  Scenario: Enter selects the highlighted construct
    Given the logic autocomplete popup is open
    And the "if" construct is highlighted
    When I press Enter
    Then the "if" block template is inserted
    And the popup closes

  @integration @unimplemented
  Scenario: Tab selects the highlighted construct
    Given the logic autocomplete popup is open
    And the "for" construct is highlighted
    When I press Tab
    Then the "for" block template is inserted
    And the popup closes

  @integration @unimplemented
  Scenario: Escape closes the popup without inserting
    Given the logic autocomplete popup is open
    When I press Escape
    Then the popup closes
    And no construct is inserted
    And the "{% " text remains in the textarea

  # ============================================================================
  # Mutual exclusion with {{ variable menu
  # ============================================================================

  @integration @unimplemented
  Scenario: Opening logic popup closes variable menu
    Given the variable insertion menu is open from typing "{{"
    When I clear the textarea and type "{%"
    Then the variable insertion menu closes
    And the logic autocomplete popup appears

  @integration @unimplemented
  Scenario: Opening variable menu closes logic popup
    Given the logic autocomplete popup is open from typing "{%"
    When I clear the textarea and type "{{"
    Then the logic autocomplete popup closes
    And the variable insertion menu appears

  @integration @unimplemented
  Scenario: Only one popup is visible at a time
    Given the textarea is focused
    When I type "{%"
    Then the logic autocomplete popup appears
    And the variable insertion menu does not appear

  # ============================================================================
  # Edge cases
  # ============================================================================

  @integration @unimplemented
  Scenario: Popup closes when clicking outside
    Given the logic autocomplete popup is open
    When I click outside the popup and textarea
    Then the popup closes

  @integration @unimplemented
  Scenario: Completing {% tag manually does not leave popup open
    Given the textarea is focused
    When I type "{% if x %}"
    Then the logic autocomplete popup is not visible

  @integration @unimplemented
  Scenario: Multiple {% insertions in same text
    Given the textarea contains "{% if x %}hello{% endif %}"
    When I position cursor at the end and type " {%"
    Then the logic autocomplete popup opens for the new "{%"
