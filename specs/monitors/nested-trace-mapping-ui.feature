@integration
Feature: Nested Trace Mapping UI
  As a user
  I want to select nested trace fields with cascading badges
  So that I can precisely map evaluator inputs to trace attributes

  Background:
    Given I am in the evaluator editor configuring mappings
    And I have sample traces available

  Scenario: Select simple field (no nesting)
    Given I'm mapping the "input" evaluator field
    When I click the mapping input
    And I select "input" from trace sources
    Then a single badge "input" should appear
    And no nested selector should show
    And the mapping should be complete

  Scenario: Select field with one level of nesting (metadata)
    Given I'm mapping the "customer_type" evaluator field
    When I click the mapping input
    And I select "metadata" from trace sources
    Then a badge "metadata" should appear
    And a second dropdown should appear with available metadata keys
    When I select "customer_type" from the nested dropdown
    Then a second badge "customer_type" should appear
    And the mapping should be complete
    And the value should be { source: "metadata", key: "customer_type" }

  Scenario: Select field with two levels of nesting (spans)
    Given I'm mapping the "llm_output" evaluator field
    And traces have spans from multiple models
    When I select "spans" from trace sources
    Then a badge "spans" should appear
    And a dropdown with span names should appear
    When I select "gpt-4o" from the span names
    Then a badge "gpt-4o" should appear
    And a dropdown with span fields should appear
    When I select "output" from span fields
    Then a badge "output" should appear
    And the mapping should be complete
    And the value should be { source: "spans", key: "gpt-4o", subkey: "output" }

  Scenario: Remove nested badge to re-select
    Given I have mapped "metadata -> customer_type"
    When I click the X on the "customer_type" badge
    Then only the "metadata" badge should remain
    And the nested key dropdown should reappear
    And I should be able to select a different key

  Scenario: Remove root badge clears all
    Given I have mapped "metadata -> customer_type"
    When I click the X on the "metadata" badge
    Then both badges should be removed
    And the input should return to empty state
    And the mapping should be cleared

  Scenario: Remove middle badge in three-level nesting
    Given I have mapped "spans -> gpt-4o -> output"
    When I click the X on the "gpt-4o" badge
    Then "spans" badge should remain
    And "output" badge should be removed
    And span names dropdown should reappear

  Scenario: Thread level traces mapping with multi-select
    Given I'm mapping "conversation" for thread level
    And thread sources are available
    When I select "traces" from thread sources
    Then a badge "traces" should appear
    And a multi-select dropdown should appear with trace field options
    When I select "input" and "output" fields
    Then badges for "input" and "output" should appear inside the multi-select
    And the mapping should include selectedFields: ["input", "output"]

  Scenario: Keyboard navigation in dropdown
    Given the mapping dropdown is open
    When I press Arrow Down
    Then the next option should be highlighted
    When I press Enter
    Then the highlighted option should be selected

  Scenario: Search/filter in dropdown
    Given the mapping dropdown is open with many options
    When I type "meta"
    Then only options containing "meta" should be visible
    And "metadata" should be in the filtered list

  Scenario: Visual connector between badges
    Given I have selected "metadata" as the source
    And the nested dropdown is visible
    Then there should be an L-shaped connector
    And the connector should visually link the badges

  Scenario: Dropdown closes on outside click
    Given the mapping dropdown is open
    When I click outside the dropdown
    Then the dropdown should close
    And my current selection should be preserved

  Scenario: Hover state on badges
    Given I have a badge "metadata" displayed
    When I hover over the badge
    Then the X button should become more visible
    And the badge should have a hover state

  Scenario: Empty state with no sources
    Given no trace sources are available
    When I open the mapping dropdown
    Then a message should indicate "No sources available"
    And I should be able to enter a literal value instead
