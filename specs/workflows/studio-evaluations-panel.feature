# Studio evaluations panel — Gherkin Spec
# Implementation: langwatch/src/optimization_studio/components/ResultsPanel.tsx
# (EvaluationResults) and
# langwatch/src/components/batch-evaluation-results/BatchSummaryFooter.tsx
#
# The evaluations panel at the bottom of the studio shows the runs of the
# workflow's experiment inline, but the full experiment results page has
# more room (comparisons, filters, sharing). The panel links across so the
# operator never has to reconstruct the experiment URL by hand.

Feature: Studio evaluations panel
  As a workflow author evaluating in the studio
  I want the evaluations panel to link to the full results page
  So that I can inspect a run with the full-page tooling without leaving my flow

  Background:
    Given I am logged into a project
    And a workflow has at least one evaluation run

  Rule: The selected run links to the full experiment results page

    @integration
    Scenario: Opening the full results page for the selected run
      Given the evaluations panel shows a selected run
      When I click the open-full-results button in the run summary footer
      Then the experiment results page opens in a new tab
      And the page is scoped to the selected run

  Rule: The panel shows how to trigger the same evaluation from the API

    @integration
    Scenario: The run-via-API dialog shows a copyable snippet for this workflow
      Given the evaluations panel shows a selected run
      When I click the run-via-API button in the run summary footer
      Then a dialog shows a curl snippet for the workflow's evaluate endpoint
      And the snippet authenticates with the project API key header
      And the snippet states it runs against the workflow's attached dataset

    # The snippet used to hardcode a "feature_flag" placeholder, which read as
    # the workflow's actual inputs and left authors unsure where the row data
    # came from. The parameters now mirror the entry point's own fields, so the
    # example is real for this workflow.

    @integration
    Scenario: The parameters example mirrors the entry point fields the dataset does not provide
      Given the entry point declares a "feature_flag" field with no matching dataset column
      And the entry point also declares fields that match dataset columns
      When I open the run-via-API dialog
      Then the parameters example includes "feature_flag" with an example value of its type
      And the parameters example omits the entry fields that match a dataset column

    @integration
    Scenario: An image entry field gets a base64 data-url example
      Given the entry point declares an image-typed field the dataset does not provide
      When I open the run-via-API dialog
      Then the parameters example shows that field with a base64 data-url value

    @integration
    Scenario: With every entry field already provided by the dataset the snippet shows an illustrative flag
      Given every entry field matches a dataset column
      When I open the run-via-API dialog
      Then the parameters example shows an illustrative feature-flag value
      And a comment explains parameters are constant per-row inputs for fields the dataset does not provide
