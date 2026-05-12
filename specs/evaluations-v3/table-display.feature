@unit
Feature: Table display and interaction features
  As a user viewing data in the evaluations workbench
  I want a rich table experience with resizing, formatting, and row modes
  So that I can efficiently work with large datasets

  Background:
    Given I render the EvaluationsV3 spreadsheet table
    And the dataset has columns "input", "expected_output", and "metadata"

  # ============================================================================
  # Sticky Headers
  # ============================================================================

  @unimplemented
  Scenario: Super header sticks when scrolling
    Given the dataset has 50 rows
    When I scroll down the table
    Then the super header row (Dataset/Agents) remains fixed at the top
    And the column header row remains fixed below the super header

  @unimplemented
  Scenario: Both header rows maintain borders when sticky
    Given the dataset has 50 rows
    When I scroll down the table
    Then the super header has a visible bottom border
    And the column headers have a visible bottom border

  # ============================================================================
  # Resizable Columns
  # ============================================================================

  @unimplemented
  Scenario: Resize column by dragging header border
    Given the "input" column has default width
    When I hover near the right edge of the "input" column header
    Then a resize handle indicator appears
    When I drag the handle to the right
    Then the "input" column width increases
    And the table layout adjusts accordingly

  @unimplemented
  Scenario: Resize indicator only appears near column edge
    Given the "input" column header is visible
    When I hover in the center of the "input" column header
    Then no resize handle indicator is visible
    When I hover near the right edge of the header
    Then the resize handle indicator appears

  @unimplemented
  Scenario: Column widths persist across page refresh
    Given I resize the "input" column to 300px
    When I refresh the page
    Then the "input" column is still 300px wide

  @unimplemented
  Scenario: Column widths persist when switching datasets
    Given I have datasets "Test Data" and "Other Data" in the workbench
    And I resize the "input" column to 300px
    When I switch to "Other Data" dataset
    And I switch back to "Test Data" dataset
    Then the "input" column is still 300px wide

  # ============================================================================
  # JSON/List Column Formatting
  # ============================================================================

  @unimplemented
  Scenario: JSON column displays formatted content
    Given the "metadata" column has type "json"
    And row 0 has "metadata" value '{"key": "value", "nested": {"a": 1}}'
    Then the cell displays the JSON with proper indentation
    And the cell uses a monospace font

  @unimplemented
  Scenario: List column displays formatted content
    Given the "metadata" column has type "list"
    And row 0 has "metadata" value '["item1", "item2", "item3"]'
    Then the cell displays the list with proper indentation
    And the cell uses a monospace font

  @unimplemented
  Scenario: String values in JSON columns are parsed
    Given the "metadata" column has type "json"
    And row 0 has "metadata" value stored as string '{"key": "value"}'
    Then the cell attempts to parse it as JSON
    And displays the formatted result

  @unimplemented
  Scenario: Large values are truncated for performance
    Given row 0 has "input" value with 10000 characters
    Then the cell displays only the first 5000 characters
    And a "(truncated)" indicator is shown

  # ============================================================================
  # Compact/Expanded Row Mode
  # ============================================================================
  @unimplemented
  Scenario: Expand individual cell in compact mode
    Given the table is in compact mode
    And row 0 has content that overflows
    When I click on the fade overlay of row 0, column "input"
    Then that specific cell expands to show full content
    And other cells remain compact

  @unimplemented
  Scenario: Collapse individual expanded cell
    Given the table is in compact mode
    And cell (0, "input") is individually expanded
    Then a collapse bar appears at the bottom of the cell
    When I click the collapse bar
    Then the cell returns to compact mode

  @unimplemented
  Scenario: Drag to resize individual cell height
    Given the table is in compact mode
    And cell (0, "input") is individually expanded
    When I drag the collapse bar downward
    Then the cell height increases
    When I drag the collapse bar upward past minimum
    Then the cell collapses to compact mode

  @unimplemented
  Scenario: Collapse bar appears on hover for overflowing compact cells
    Given the table is in compact mode
    And row 0 has content that overflows
    When I hover over the cell at (0, "input")
    Then the collapse/resize bar becomes visible
    And I can drag it to expand the cell

  @unimplemented
  Scenario: Fade overlay matches cell background on hover
    Given the table is in compact mode
    And row 0 has content that overflows
    When I hover over row 0
    Then the fade overlay gradient matches the hover background color
