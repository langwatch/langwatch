Feature: Field editor
  As someone editing a prompt's variables and outputs
  I want both lists to share one grid, one name field and one remove button
  So that columns line up and nothing looks different between them

  @integration
  Scenario: Field editor sections share aligned columns
    Given a Variables section and an Outputs section
    Then both rows place type, name and remove in the same grid areas
    And an output with no value leaves the value column empty

  @integration
  Scenario: A field row reads inline, the value taking the rest of the width
    Given a Variables row with a type, a short name, a mapping and a remove button
    Then the "=" sits right after the name, with no gap column between them
    And the value stretches from the "=" to the remove button
    And the section heading is bold uppercase with no extra letter spacing

  @integration
  Scenario: Field editor rows fit a narrow drawer
    Given a Variables and an Outputs section 320px wide
    Then the value moves below the name and the page does not scroll sideways

  @integration
  Scenario: A name can be edited entirely with the keyboard
    Given an editable field name
    When the reader presses Enter on it, types and presses Enter again
    Then the draft is committed once and Escape cancels once

  @integration
  Scenario: Long names keep their adjacent information reachable
    Given a very long field name with an information icon
    Then the full name is the accessible name and the icon follows it in the same group

  @integration
  Scenario: Field editor stories render in light and dark
    Given the Variables and Outputs pair
    Then it renders in both colour modes with its heading and rows
