# @unimplemented while this PR is in flight: scenarios are bound (and the
# @unimplemented tag dropped) when Phase 4 lands. Bindings target the
# RunViaApiButton integration tests.
@unimplemented
Feature: Run via API dialog for workflows and evaluations-v3
  As a user wiring an evaluation into CI
  I want the Run via API dialog to show how to pass my data and read results back
  So that I can run from a script in my own language without guessing the request shape.

  # One shared dialog serves both the workflow results panel and the
  # evaluations-v3 workbench. It offers a data-source choice and a language
  # choice, and always shows how to get the results back.

  Background:
    Given a workflow with an attached dataset and an entry field the dataset does not provide

  @unit
  Scenario: Python is the default language
    When I open the Run via API dialog
    Then the snippet shown is Python
    And the language options are Python, then TypeScript, then Shell

  @unit
  Scenario: The data-source choice changes the snippet body
    When I open the Run via API dialog
    And I choose the inline data source
    Then the snippet shows how to pass data rows
    When I choose the dataset id source
    Then the snippet shows how to pass a dataset id
    When I choose the attached dataset source
    Then the snippet shows the constant parameters only

  @unit
  Scenario: The dialog shows how to read results back
    When I open the Run via API dialog
    Then the Python snippet shows reading the per-row results and the run url
    And the Shell snippet shows polling the run and fetching the results

  @unit
  Scenario: The evaluations-v3 dialog targets the experiment run endpoint
    Given an evaluations-v3 experiment
    When I open its Run via API dialog and choose Shell
    Then the curl posts to the experiment run endpoint for that experiment
