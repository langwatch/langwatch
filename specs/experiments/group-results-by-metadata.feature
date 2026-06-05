@integration @unimplemented
Feature: Group experiment comparison table by dataset-entry metadata
  As a user comparing batch evaluation runs
  I want to group the comparison table rows by a metadata field on the
  dataset entries
  So that I can analyze evaluator results sliced by attributes like
  city, locale, or difficulty without leaving the side-by-side view

  Background:
    Given I am viewing an experiment with multiple batch runs in
      comparison mode
    And the dataset entries carry metadata fields such as "city" and
      "difficulty"

  Scenario: The Group rows by dropdown lists every metadata key from the dataset
    When I open the "Group rows by" dropdown
    Then I see "No grouping" as the first option
    And I see every metadata field present on the dataset entries as a
      selectable option

  Scenario: Rows group under metadata-value headers
    When I select "city" from the "Group rows by" dropdown
    Then the rows are grouped under headers for each distinct city
    And rows with the same city value appear together under that header

  Scenario: Group headers show row count and per-run mean evaluator scores
    Given the table is grouped by a metadata field
    Then each group header shows how many rows belong to that group
    And each group header shows the mean score per evaluator within
      that group, with one value per run in the comparison

  Scenario: Groups can be collapsed and expanded
    Given the table is grouped by a metadata field
    When I click a group header
    Then the rows under that group are hidden
    And the header stays visible with its aggregates
    When I click the same header again
    Then the rows under that group are visible again

  Scenario: Grouping selection survives reload via the URL
    When I select a grouping field
    And I reload the page
    Then the grouping selection is preserved
    And the rows are grouped under the same headers

  Scenario: Choosing No grouping restores the flat row order
    Given the table is grouped by a metadata field
    When I select "No grouping" from the "Group rows by" dropdown
    Then the rows appear in their original flat order with no group
      headers
    And the URL no longer carries a grouping parameter

  Scenario: Rows with no value for the selected field fall into an Unspecified group
    Given some dataset entries are missing the selected metadata field
    When I select that field for grouping
    Then the rows missing the field appear under a single "Unspecified"
      group header at the bottom of the table

  Scenario: Dropdown only offers keys present on the current runs' dataset entries
    Given the dataset entries in the current comparison expose only
      "city" and "difficulty"
    When I open the "Group rows by" dropdown
    Then I do not see metadata keys from other experiments or other
      runs as grouping options
