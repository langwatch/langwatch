Feature: Page body widths
  As someone building a page
  I want the page body's width to be a named choice of the design system
  So that no page sets its own maxWidth or centring and every page lines up
  Rulings: dev/docs/design/guidelines.md section 4, packages/design-system/adrs/002-overlay-and-card-shapes.md

  @integration
  Scenario: A narrow page body is one centred reading column
    Given a page whose content reads as one column, such as a section's overview
    When its body is a narrow page container
    Then the body is at most 900px wide
    And it is centred in the page with equal space on both sides
    And it keeps the page inset every other body has
