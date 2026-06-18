# @unimplemented while this PR is in flight: scenarios are bound (and the
# @unimplemented tag dropped) when Phase 4 lands. Bindings target
# langwatch/src/components/run-via-api/__tests__/runSnippets.unit.test.ts.
@unimplemented
Feature: Run via API snippet generator
  As the Run via API dialog
  I want a pure generator that builds a snippet for any language and data source
  So that both dialogs share one source of truth and the examples stay correct.

  # The generator produces Python, TypeScript, and Shell snippets for the
  # attached-dataset, inline-data, and dataset-id sources, for either a
  # workflow or an experiment target.

  @unit
  Scenario: The parameters example omits fields the dataset already provides
    Given an entry with fields "question" and "feature_flag"
    And a dataset that provides "question"
    When I generate the attached-dataset snippet
    Then the parameters example includes "feature_flag"
    And the parameters example omits "question"

  @unit
  Scenario: An image entry field gets a base64 data-url example
    Given an entry with an image-typed field the dataset does not provide
    When I generate the snippet
    Then that field's example value is a base64 data url

  @unit
  Scenario: When the dataset covers every field the example shows an illustrative flag
    Given every entry field is provided by the dataset
    When I generate the snippet
    Then the parameters example shows an illustrative feature-flag value

  @unit
  Scenario: The inline-data snippet shows example rows
    When I generate the inline-data snippet
    Then it shows a small list of example data rows, not the whole dataset

  @unit
  Scenario: The dataset-id snippet shows a dataset id placeholder
    When I generate the dataset-id snippet
    Then it shows a dataset id field with a placeholder to replace

  @unit
  Scenario: Each language snippet shows how to read the results back
    When I generate the Python, TypeScript, and Shell snippets
    Then the Python snippet reads per-row results and the run url
    And the TypeScript snippet reads the rows and the run url
    And the Shell snippet starts the run, polls it, then fetches the results
