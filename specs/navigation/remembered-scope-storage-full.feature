Feature: Remembering the scope when the browser's storage is full
  As a signed-in reader whose browser storage for the site is full
  I want the page to keep working
  So that a cache I cannot see does not lock me out of the product

  Remembering the organization, team and project is a convenience for the
  next visit. The browser refuses a write when the site's storage is full,
  and that refusal must cost the reader the memory, not the page.

  @unit
  Scenario: A full storage skips the memory instead of breaking the page
    Given the browser refuses every storage write because its quota is full
    When the page remembers the organization, team and project it resolved
    Then nothing is thrown
    And no reader is told about a write that did not happen
