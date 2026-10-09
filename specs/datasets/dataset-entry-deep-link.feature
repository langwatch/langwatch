Feature: Dataset entry deep-link from experiment results
  As a user reviewing batch evaluation results
  I want to jump from a result row to its source dataset entry
  So that I don't have to manually count rows in a 50+ entry dataset

  # Issue #8190. An experiment result row's only identifier is otherwise its
  # zero-based index. The dataset-editor side orders by createdAt ascending,
  # the same order the experiment-run dataset snapshot was built from, so the
  # index still resolves correctly as long as no rows were added to or
  # removed from the dataset since the run — an inherent limit of an
  # index-only reference, not something this feature tries to solve.

  Background:
    Given a BATCH_EVALUATION_V2 experiment that ran against a saved dataset

  # ============================================================================
  # The link
  # ============================================================================

  @integration @unimplemented
  Scenario: A result row links back to its dataset entry
    Given the experiment has a recorded dataset association
    When I view the experiment's results
    Then each result row has a "View in dataset" link
    And the link opens "/{project}/datasets/{datasetId}?row={index}" in a new tab

  @integration @unimplemented
  Scenario: No dataset association means no dangling link
    Given the experiment has no recorded dataset association
    When I view the experiment's results
    Then no "View in dataset" link is shown

  # ============================================================================
  # Arriving at the dataset
  # ============================================================================

  @integration @unimplemented
  Scenario: The deep-link opens on the entry's page, already highlighted
    Given a dataset with more rows than fit on one page
    When I open the dataset at a row index from a later page
    Then the editor opens directly on the page that row is on
    And that row is scrolled into view and briefly highlighted

  # ============================================================================
  # Row → page resolution (pure logic, unit-tested directly)
  # ============================================================================

  @unit
  Scenario: A row index resolves to its page and position on that page
    Given a page size of 50 rows
    When row index 127 is resolved
    Then it is on page 3 at position 27

  @unit
  Scenario: A malformed or missing row query value is ignored
    Given a dataset page URL
    When its "row" query value is not a plain non-negative integer
    Then the editor opens on page 1 with nothing highlighted
