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
