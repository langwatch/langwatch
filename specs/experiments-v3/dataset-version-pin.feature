Feature: An experiment can pin the saved dataset version its runs read
  As someone running an experiment over a saved dataset
  I want to pin the experiment to one version of that dataset, or to a version per run
  So that runs from CI, the API or an SDK compare like with like while the dataset keeps changing

  # The workbench board always shows the dataset's current rows. A run over another version
  # writes its cells back onto the board rows with the same ids, since a version keeps the
  # ids its rows had. Versioning itself: modules/dataset/specs/dataset-versioning.feature.

  # --- Pin control ---

  @integration
  Scenario: The dataset version select lists Latest and every version, newest first
    Given an experiment whose saved dataset has versions 1 and 2, version 2 named "cleaned"
    When I look at the dataset header
    Then the dataset tab's menu has "Dataset version (Latest)" and the tab shows no version badge
    And that submenu offers "Latest version", "Version 2 · cleaned" and "Version 1", in that order

  @integration
  Scenario: Choosing a version pins the experiment to it
    Given an experiment whose saved dataset has versions 1 and 2
    When I choose "Version 1" in the dataset version select
    Then the experiment's saved dataset reference pins version 1
    And the dataset tab shows a "v1" badge

  @integration
  Scenario: Choosing Latest removes the pin
    Given an experiment pinned to version 1 of its saved dataset
    When I choose "Latest version" in the dataset version select
    Then the experiment's saved dataset reference pins no version

  @integration
  Scenario: An inline dataset offers no version select
    Given an experiment whose active dataset is inline
    When I open the dataset tab's menu
    Then it has no dataset version submenu

  @unit
  Scenario: A run started on the workbench page reads the rows the board shows
    Given an experiment pinned to version 1 of its saved dataset
    When I run it from the workbench page
    Then the run reads the dataset's current content, not version 1

  # --- Workflow evaluate API ---

  @unit
  Scenario: The workflow evaluate API takes a dataset version
    Given a workflow whose attached saved dataset has versions 1 and 2
    When the workflow evaluate API is called with "dataset_version" 1
    Then the evaluation reads version 1's rows
    And version 1 records the run that used it

  @unit
  Scenario: The workflow evaluate API refuses a version the dataset does not have
    Given a workflow whose attached saved dataset has versions 1 and 2
    When the workflow evaluate API is called with "dataset_version" 5
    Then it is refused with code "dataset_version_not_found"
    And no evaluation is sent to the worker

  @unit
  Scenario: The workflow evaluate API refuses a dataset version with no saved dataset to read
    Given a workflow whose attached dataset is inline
    When the workflow evaluate API is called with "dataset_version" 1
    Then it is refused with code "experiment_evaluation_input_invalid"

  @unit
  Scenario: The run API refuses a dataset version with no saved dataset to read
    Given a saved experiment whose active dataset is inline
    When the run API is called with "dataset_version" 1 and no "dataset_id"
    Then it is refused with a 400 and code "experiment_evaluation_input_invalid"
    And no run starts
    And the same call naming a saved dataset in "dataset_id" reads that dataset's version 1

  @unit
  Scenario: The workflow evaluate API refuses a dataset version sent with inline data
    When the workflow evaluate API is called with inline data and "dataset_version" 1
    Then the body fails validation on "dataset_version"

  @integration @unit
  Scenario: An open workbench shows a saved dataset's new rows after it changes elsewhere
    Given a workbench open on saved dataset "qa" showing "a" and "b4"
    When an older version of "qa" with "a-EDITED", "b" and "c" is restored on the dataset page
    Then the workbench shows "a-EDITED", "b" and "c" without a reload
    And a cell edited in the workbench and not yet synced keeps its value
    And a row deleted in the workbench and not yet synced stays deleted
    And a read keyed by other columns than the workbench's leaves its rows as they are

  @unit
  Scenario: Saving an experiment pinned to a dataset version keeps that version
    Given an experiment whose saved dataset is pinned to version 3
    When the experiment is saved
    Then version 3 is marked pinned, so the retention sweep never thins it

  # --- Writing results back ---

  @unit
  Scenario: A run pinned to a dataset version writes its results back onto the board
    Given a saved experiment whose dataset rows changed order since version 1
    When the run API is called with "dataset_version" 1
    Then the run writes its cells back to the board
    And each cell lands on the board row with the same row id

  @unit
  Scenario: A pinned run skips rows the board no longer has
    Given version 1 of the dataset holds a row that has since been deleted
    When a run over version 1 writes its cells back
    Then the deleted row's cells are left out
    And every other cell lands on the board row with the same row id

  @unit
  Scenario: A pinned run carries the board's results on the run's own rows
    Given a board with saved results and dataset rows that changed order since version 1
    When a run over version 1 is prepared
    Then each carried cell sits at the run row with the same row id
    And a board row version 1 does not hold carries nothing

  @unit
  Scenario: A pinned run keeps the results of board rows the version does not hold
    Given a board row was added to the dataset after version 1
    And the board holds that row's results from an earlier run
    When a run over version 1 writes its cells back
    Then that row keeps its earlier results

  @unit
  Scenario: Board rows are read in smaller pages when a page is too large for one response
    Given a saved dataset whose first page of row ids is too large for one response
    When a pinned run reads the board's row ids
    Then it asks again with the smaller limit the refusal names
    And it reads every row id once, in order
