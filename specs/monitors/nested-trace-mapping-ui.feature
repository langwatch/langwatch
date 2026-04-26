@integration
Feature: Nested Trace Mapping UI
  As a user
  I want to select nested trace fields with cascading badges
  So that I can precisely map evaluator inputs to trace attributes

  Background:
    Given I am in the evaluator editor configuring mappings
    And I have sample traces available

  @unimplemented
  Scenario: Select simple field (no nesting)
    Given I'm mapping the "input" evaluator field
    When I click the mapping input
    And I select "input" from trace sources
    Then a single badge "input" should appear
    And no nested selector should show
    And the mapping should be complete

  @unimplemented
  Scenario: Remove nested badge to re-select
    Given I have mapped "metadata -> customer_type"
    When I click the X on the "customer_type" badge
    Then only the "metadata" badge should remain
    And the nested key dropdown should reappear
    And I should be able to select a different key

  @unimplemented
  Scenario: Remove root badge clears all
    Given I have mapped "metadata -> customer_type"
    When I click the X on the "metadata" badge
    Then both badges should be removed
    And the input should return to empty state
    And the mapping should be cleared

  @unimplemented
  Scenario: Remove middle badge in three-level nesting
    Given I have mapped "spans -> gpt-4o -> output"
    When I click the X on the "gpt-4o" badge
    Then "spans" badge should remain
    And "output" badge should be removed
    And span names dropdown should reappear

  @unimplemented
  Scenario: Keyboard navigation in dropdown
    Given the mapping dropdown is open
    When I press Arrow Down
    Then the next option should be highlighted
    When I press Enter
    Then the highlighted option should be selected

  @unimplemented
  Scenario: Search/filter in dropdown
    Given the mapping dropdown is open with many options
    When I type "meta"
    Then only options containing "meta" should be visible
    And "metadata" should be in the filtered list

  @unimplemented
  Scenario: Dropdown closes on outside click
    Given the mapping dropdown is open
    When I click outside the dropdown
    Then the dropdown should close
    And my current selection should be preserved

  @unimplemented
  Scenario: Empty state with no sources
    Given no trace sources are available
    When I open the mapping dropdown
    Then a message should indicate "No sources available"
    And I should be able to enter a literal value instead
