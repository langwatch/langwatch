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
  Scenario: Popup closes when clicking outside
    Given the logic autocomplete popup is open
    When I click outside the popup and textarea
    Then the popup closes
