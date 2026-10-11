Feature: The shape census measures how far screens are from the design system
  Each table, card, page, header, list page, pagination, drawer, dialog, empty state and tab
  is counted from the syntax tree of the browser sources, so a rollout can be cut by area.

  @unit
  Scenario: A shape site is a clean design-system use, a restyled one or a hand-built look-alike
    Given a browser source that renders a design-system component or a layout primitive
    When the census reads it
    Then a design-system component with no style props counts as a clean site
    And style or layout props on the component or its parts count as a restyle, listing each prop
    And a primitive drawing the same shape by hand counts as a look-alike of that family

  @unit
  Scenario: Each distinct restyle of a family counts once as a variant
    Given several sites restyling the same design-system component
    When the census summarises them
    Then each distinct set of override props counts as one variant
    And the most common sets are listed with their count and example locations
