Feature: Model picker search stays clear of its rows
  As someone picking a model from a long list
  I want the search field to stay readable while I scroll
  So that no row shows through or behind it

  # Only the rows scroll, below the search; the search never scrolls with them.

  @integration
  Scenario: A scrolled Default models picker keeps its rows below the search
    Given the Default models picker is open with more rows than fit
    When I scroll the rows
    Then no row is drawn over or above the search field
    And the search field is what sits under its own area

  @integration
  Scenario: A scrolled evaluator model picker keeps its rows below the search
    Given the evaluator model picker is open with more rows than fit
    When I scroll the rows
    Then no row is drawn over or above the search field
    And the search field is what sits under its own area
