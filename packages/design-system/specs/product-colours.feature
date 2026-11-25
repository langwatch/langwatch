Feature: Product colours
  As someone tuning how each LangWatch product looks
  I want one design-system file to say which accent each product draws
  So that a tweak or a removal is one edit and tabs and other accent uses follow
  Rulings: packages/design-system/adrs/003-content-tabs-and-table-parts.md

  @unit
  Scenario: The map gives Me blue and keeps the current accent for the other products
    Given the product colour map
    Then Me is blue
    And LLM Ops, Dashboards, Gateway and Governance are the accent
    And each product's roles resolve to the same values as that palette in both colour modes

  @unit
  Scenario: Changing a product's palette changes every role it generates
    Given a map that gives a product another palette
    Then all ten roles of that product alias the new palette

  @unit
  Scenario: A product set to null resolves to neutral gray everywhere
    Given a map that sets a product to null
    Then the product keeps its identity
    And all ten roles of that product alias gray

  @unit
  Scenario: The theme registers exactly what the map generates
    Given the design system theme
    Then its product tokens equal the tokens generated from the map
    And the global accent and orange tokens are unchanged

  @integration
  Scenario: A scope names the product and a hook reads its accent
    Given a surface inside a product scope
    Then the hook returns that product's palette and role tokens
    And a surface outside any scope gets the unscoped accent

  @integration
  Scenario: Scopes nest and a null scope resets to the unscoped accent
    Given a product scope inside another and a null scope inside a product
    Then the innermost scope wins
    And the null scope reads the unscoped accent

  @integration
  Scenario: A portalled surface keeps the product it was opened from
    Given a surface rendered through a portal outside the page's DOM subtree
    Then it reads the product of the scope it was rendered in

  @integration
  Scenario: Tabs draw the product's accent and keep their behaviour in every scope
    Given content tabs inside each product scope and outside any scope
    Then the tabs take the product's palette
    And arrow keys, selection and the mount policy behave as they do unscoped
