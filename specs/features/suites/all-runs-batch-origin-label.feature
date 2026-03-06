Feature: All Runs batch entries display suite or set origin
  As a user viewing the All Runs panel
  I want each batch entry to show which suite or external set it belongs to
  So that I can identify the origin of each batch without clicking into it

  Scope: All Runs view only (AllRunsPanel). Suite-specific run history is unchanged.

  Display rules:
    - Suite runs: show the suite name (resolved from the suite ID)
    - External runs: show the scenario set ID as the label
    - The label is visible in the collapsed row header without expanding

  Background:
    Given a project with suites and external sets that have batch runs

  @integration
  Scenario: Suite batch entry displays the suite name
    Given a batch run belonging to suite "Regression Tests"
    When the batch entry is rendered in the All Runs panel
    Then the row header displays "Regression Tests" as the origin label

  @integration
  Scenario: External set batch entry displays the set name
    Given a batch run belonging to external set "nightly-ci"
    When the batch entry is rendered in the All Runs panel
    Then the row header displays "nightly-ci" as the origin label

  @integration
  Scenario: Batch entry without a known set shows no origin label
    Given a batch run with no associated scenario set ID
    When the batch entry is rendered in the All Runs panel
    Then the row header does not display an origin label
