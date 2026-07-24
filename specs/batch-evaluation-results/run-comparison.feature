Feature: Run Comparison
  As a user evaluating LLM outputs
  I want to compare multiple evaluation runs side-by-side
  So that I can understand improvements and differences across experiments

  Background:
    Given I have an experiment with multiple evaluation runs
    And each run has targets with metadata (model, prompt_id, version, custom fields)

  # ============================================================================
  # Compare Mode Activation
  # ============================================================================

  Scenario: Compare button is disabled with single run
    Given there is only 1 evaluation run
    When I view the batch evaluation results page
    Then the "Compare" button is disabled
    And hovering shows tooltip "Need at least 2 runs to compare"

  Scenario: Compare button is enabled with multiple runs
    Given there are 3 evaluation runs
    When I view the batch evaluation results page
    Then the "Compare" button is enabled

  Scenario: Entering compare mode auto-selects runs
    Given there are 3 evaluation runs
    And I am viewing run "swift-bright-fox"
    When I click the "Compare" button
    Then compare mode is activated
    And run "swift-bright-fox" is selected for comparison
    And the next run in the list is also selected
    And checkboxes appear on each run in the sidebar

  Scenario: Exiting compare mode
    Given I am in compare mode with 2 runs selected
    When I click "Exit Compare" button
    Then compare mode is deactivated
    And checkboxes disappear from the sidebar
    And the table returns to single-run view

  # ============================================================================
  # Run Selection in Compare Mode
  # ============================================================================

  Scenario: Selecting runs via checkboxes
    Given I am in compare mode
    When I check the checkbox for run "calm-eager-owl"
    Then run "calm-eager-owl" is added to the comparison
    And the table updates to show values from all selected runs

  Scenario: Deselecting runs
    Given I am in compare mode with 3 runs selected
    When I uncheck the checkbox for run "noble-vivid-storm"
    Then run "noble-vivid-storm" is removed from the comparison
    And the table updates to show only remaining selected runs

  Scenario: Minimum selection enforced
    Given I am in compare mode with 2 runs selected
    When I try to uncheck a run leaving only 1 selected
    Then the action is prevented
    And a tooltip shows "At least 2 runs must be selected"

  # ============================================================================
  # Diff Table Display
  # ============================================================================

  Scenario: Table shows stacked values in compare mode
    Given I am in compare mode with runs "run-a" and "run-b" selected
    When I view the results table
    Then each cell shows values from both runs stacked vertically
    And each value has a small colored circle indicating its run
    And the colors match the run indicators in the sidebar

  Scenario: Dataset columns show diff for identical entries
    Given I am comparing runs that used the same dataset
    When I view a dataset column cell
    Then I see the same value once (not duplicated)
    And a note indicates "Same across runs"

  Scenario: Target output columns show diff
    Given runs have different outputs for the same dataset row
    When I view a target output cell
    Then I see each run's output stacked with run color indicator
    And outputs are displayed in the same order as runs in sidebar

  Scenario: Evaluator results show diff
    Given runs have different evaluator scores for the same row
    When I view evaluator chips in a target cell
    Then I see evaluator results from each run
    And each result has its run's color indicator

  # ============================================================================
  # Comparison Charts
  # ============================================================================

  Scenario: Charts appear above table in compare mode
    Given I am in compare mode with 2 runs selected
    Then comparison charts appear above the results table
    And charts show bar graphs for key metrics

  Scenario: Default charts displayed
    Given I am in compare mode
    Then I see bar charts for:
      | Chart Title      |
      | Total Cost       |
      | Average Latency  |
      | Pass Rate        |
    And each evaluator with scores has its own chart

  Scenario: Chart X-axis defaults to Runs
    Given I am in compare mode
    When I view the X-axis dropdown
    Then "Runs" is selected by default
    And bars are grouped by run ID/name

  Scenario: Changing X-axis to model
    Given I am in compare mode
    And runs have targets with different "model" values
    When I change X-axis to "Model"
    Then bars are grouped by model name
    And if multiple runs have same model, their metrics are averaged

  Scenario: Changing X-axis to prompt
    Given I am in compare mode
    And runs have targets with prompt_id values
    When I change X-axis to "Prompt"
    Then bars are grouped by prompt name (not raw ID)
    And prompt versions are indicated if different

  Scenario: Changing X-axis to custom metadata
    Given runs have targets with custom metadata key "temperature"
    When I change X-axis to "temperature"
    Then bars are grouped by temperature value
    And legend shows the temperature values

  Scenario: X-axis options are dynamically detected
    Given runs have targets with metadata keys: model, prompt_id, temperature, top_p
    When I open the X-axis dropdown
    Then I see options: Runs, Model, Prompt, temperature, top_p
    And only keys present in at least one target are shown

  # ============================================================================
  # Chart Visibility
  # ============================================================================

  Scenario: Charts visible by default with multiple targets
    Given I am viewing an experiment where runs have 2+ targets each
    When I enter compare mode
    Then charts are shown by default

  Scenario: Charts hidden by default with single target per run
    Given I am viewing an experiment where runs have 1 target each
    When I enter compare mode
    Then charts are hidden by default
    And a "Show Charts" button is available

  Scenario: Toggle chart visibility
    Given I am in compare mode with charts visible
    When I click "Hide Charts"
    Then charts are hidden
    And button changes to "Show Charts"

  Scenario: Charts in single-run mode with metadata X-axis
    Given I am viewing a single run (not compare mode)
    And the run has multiple targets with different models
    When I click "Show Charts"
    And I change X-axis to "Model"
    Then I see charts comparing metrics across models within that run

  # ============================================================================
  # Edge Cases
  # ============================================================================

  Scenario: Runs with different evaluators
    Given run-a has evaluators: accuracy, relevance
    And run-b has evaluators: accuracy, coherence
    When I compare these runs
    Then accuracy chart shows both runs
    And relevance chart shows only run-a
    And coherence chart shows only run-b
    And missing values are indicated as "N/A"

  Scenario: Runs with different dataset sizes
    Given run-a has 10 dataset rows
    And run-b has 15 dataset rows
    When I compare these runs
    Then rows 1-10 show values from both runs
    And rows 11-15 show values only from run-b
    And run-a cells show "No data" for rows 11-15

  Scenario: Runs with different targets
    Given run-a has targets: gpt4, claude
    And run-b has targets: gpt4
    When I compare these runs
    Then gpt4 column shows values from both runs
    And claude column shows values only from run-a
