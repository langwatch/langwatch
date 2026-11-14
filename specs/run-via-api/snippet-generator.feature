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

  # ==========================================================================
  # Per-run execution for experiments (CI)
  # ==========================================================================

  @unit
  Scenario: An experiment snippet carries the run's concurrency in every language
    Given an experiment snippet with a concurrency of 4
    When I generate the Python, TypeScript, Go, Shell, CLI and GitHub Actions snippets
    Then each one starts the run with a concurrency of 4

  @unit
  Scenario: A sequential experiment snippet starts the run with a concurrency of one
    Given an experiment snippet that runs sequentially
    When I generate the CLI snippet
    Then it passes a concurrency of 1

  @unit
  Scenario: A workflow snippet carries no concurrency
    Given a workflow snippet with a concurrency of 4
    When I generate the Python and Shell snippets
    Then neither names a concurrency

  @unit
  Scenario: The CLI snippet runs the experiment and waits for it to finish
    Given an experiment with an entry field the dataset does not provide
    When I generate the CLI snippet for the attached dataset
    Then it runs "langwatch experiment run" for the experiment with --wait
    And passes the missing field as a --param flag

  @unit
  Scenario: The GitHub Actions snippet runs the CLI with the API key from a repository secret
    When I generate the GitHub Actions snippet for an experiment on a self-hosted origin
    Then it is a workflow step that runs the CLI through npx
    And it reads LANGWATCH_API_KEY from the repository's secrets
    And it points LANGWATCH_ENDPOINT at that origin

  @unit
  Scenario: The CLI snippets say they run the attached dataset when another data source is chosen
    When I generate the CLI snippet for the inline-data source
    Then it says the CLI runs the experiment's attached dataset
    And it passes no inline rows
