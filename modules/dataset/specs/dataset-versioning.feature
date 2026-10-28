Feature: Dataset version history
  As a LangWatch user
  I want my datasets to keep a history of immutable versions, like a document's history
  So that I can see what changed, go back to an earlier state, and know exactly which rows an experiment ran on

  A version is a snapshot of a dataset's columns and rows, kept in the deployment's own
  storage: a DatasetVersion row in Postgres, and the rows as JSONL chunks in the object storage
  the dataset module already writes (local disk or a bucket, so every self-hosted install has it).
  Versions are numbered per dataset from 1. A version is never edited; restoring writes a new one.
  A snapshot whose content hash equals the latest version's creates nothing new.

  # --- Saving versions ---

  @unit
  Scenario: Edits that go quiet save a version
    Given a dataset with version 1
    When a user edits a row and nobody edits the dataset for the quiet period
    Then the dataset has version 2 saved automatically, authored by that user

  @unit
  Scenario: Edits inside the quiet period save one version
    Given a dataset with version 1
    When a user edits three rows, each within the quiet period of the last
    Then exactly one new version is saved, once the dataset has been quiet for the whole period

  @unit
  Scenario: Saving a version by hand with a name
    Given a dataset with version 1
    When a user edits a row and saves a version named "Before relabel"
    Then the dataset has version 2 named "Before relabel", authored by that user

  @unit
  Scenario: Saving unchanged content creates no version
    Given a dataset whose latest version holds its current content
    When a version is saved automatically or by an experiment run
    Then no new version is created and the latest version is answered

  @unit
  Scenario: Naming unchanged content names the latest version
    Given a dataset whose latest version 3 holds its current content and has no name
    When a user saves a version named "Baseline"
    Then version 3 is named "Baseline" and no version 4 exists

  @unit
  Scenario: A dataset that is still importing is not snapshotted
    Given a dataset whose import is still processing
    When a version is saved
    Then it is refused with code "dataset_not_ready"

  @unit
  Scenario: Saving a version of a missing dataset is refused
    Given no dataset "ghost" in the project
    When a version of "ghost" is saved
    Then it is refused with code "dataset_not_found"

  # --- Reading versions ---

  @unit
  Scenario: The history lists versions newest first with author and time
    Given a dataset with versions 1, 2 and 3
    When its history is listed
    Then the versions are 3, 2 and 1, each with its author, trigger, row count and creation time

  @unit
  Scenario: Viewing a version shows its own rows and columns
    Given a dataset whose version 1 has rows "a" and "b" and whose current content has row "c" too
    When a page of version 1 is read
    Then it answers rows "a" and "b" and the columns version 1 had

  @unit
  Scenario: Reading a version the dataset does not have is refused
    Given a dataset with versions 1 and 2
    When version 7 is read
    Then it is refused with code "dataset_version_not_found"

  @unit
  Scenario: A version of another project is not readable
    Given a dataset version in another project
    When it is read from this project
    Then it is refused with code "dataset_not_found"

  @unit
  Scenario: A version larger than one whole read is refused before it is read
    Given a version with more rows than one whole read allows
    When it is read, compared or restored
    Then it is refused with code "dataset_version_too_large" before any stored rows are read

  # --- Comparing ---

  @unit
  Scenario: Comparing a version with the current content
    Given a dataset whose version 1 has rows "a", "b" and "c"
    And row "a" was changed, row "b" deleted and row "d" added since
    When version 1 is compared with the current content
    Then the comparison counts 1 added, 1 removed and 1 changed row
    And it lists row "d" as added, row "b" as removed and row "a" with its old and new values

  @unit
  Scenario: Comparing reports column changes
    Given a dataset whose version 1 had columns "input" and "output"
    And the column "expected" was added and "output" removed since
    When version 1 is compared with the current content
    Then the comparison lists "expected" as an added column and "output" as a removed column

  # --- Restoring ---

  @unit
  Scenario: Restoring a version writes a new version
    Given a dataset with versions 1 and 2
    When a user restores version 1
    Then the dataset's current columns and rows equal version 1's
    And the dataset has version 3, restored from version 1 and authored by that user
    And versions 1 and 2 are unchanged

  @unit
  Scenario: Restoring a version that holds the current content changes nothing
    Given a dataset whose latest version 2 holds its current content
    When a user restores version 2
    Then no new version is created

  @unit
  Scenario: Restoring a version the dataset does not have is refused
    Given a dataset with versions 1 and 2
    When a user restores version 9
    Then it is refused with code "dataset_version_not_found"

  @integration
  Scenario: Restoring a version needs permission to manage the dataset
    Given a member who may edit the dataset but not manage it
    When they open the history drawer
    Then they can save a version but restore is disabled with a reason

  @unit
  Scenario: Restoring a legacy single-file dataset is refused
    Given a dataset kept in the legacy single-file layout
    When a user restores one of its versions
    Then it is refused with code "dataset_version_restore_unsupported"

  # --- Experiments ---

  @unit
  Scenario: An experiment run records the dataset version it ran on
    Given a saved dataset whose content has changed since its latest version
    When an experiment run starts over it with no version pinned
    Then a new version is saved with the trigger "experiment_run"
    And the run reads exactly that version's rows
    And the version records the run that used it

  @unit
  Scenario: An experiment run can pin a dataset version
    Given a saved dataset with versions 1 and 2
    When an experiment run starts pinned to version 1
    Then the run reads version 1's rows, not the current content
    And version 1 records the run that used it

  @unit
  Scenario: A run pinned to a version keeps it out of retention
    Given a dataset with versions 1 and 2
    When an experiment run pins version 1
    Then version 1 is marked pinned, so the retention sweep never thins it

  @unit
  Scenario: Pinning a version the dataset does not have refuses the run
    Given a saved dataset with versions 1 and 2
    When an experiment run starts pinned to version 5
    Then the run is refused with code "dataset_version_not_found"

  @unit
  Scenario: A run's dataset version is shown with the run
    Given an experiment run that recorded version 2 of its dataset
    When the runs that used versions of the dataset are looked up by run id
    Then the run answers the dataset id, version id and version number 2

  @unit
  Scenario: The run API takes a dataset version
    Given a saved experiment over a saved dataset with versions 1 and 2
    When the run API is called with "dataset_version" 1
    Then the run reads version 1's rows

  # --- Retention ---

  @unit
  Scenario: Retention keeps the last day, then one a day for a month, then one a week
    Given a dataset with automatic versions every hour for the last 60 days
    When the retention sweep runs
    Then every version from the last 24 hours is kept
    And one version per day is kept for the 30 days before that
    And one version per week is kept before that
    And the latest version is always kept

  @unit
  Scenario: Retention never thins named or run versions
    Given a dataset whose 40-day-old versions include one named by hand and one used by a run
    When the retention sweep runs
    Then both of those versions are kept, whatever their age

  @unit
  Scenario: Retention removes a thinned version's stored rows
    Given a version the retention sweep thins
    When the sweep runs
    Then the version row and its stored chunks are both removed

  # --- Deletion ---

  @unit
  Scenario: An archived dataset keeps its history while it can be restored
    Given a dataset with versions, archived 10 days ago
    When the retention sweep runs
    Then its versions are still there

  @unit
  Scenario: A dataset archived for 30 days loses its history
    Given a dataset with versions, archived 30 days ago
    When the retention sweep runs
    Then every version, its stored chunks and its run links are removed

  @unit
  Scenario: A dataset that no longer exists loses its history
    Given versions of a dataset that was deleted
    When the retention sweep runs
    Then every version and its stored chunks are removed

  @unit
  Scenario: Datasets in a project archived for 30 days lose their history
    Given a project archived 30 days ago whose dataset has versions
    When the retention sweep runs
    Then every version of that dataset and its stored chunks are removed

  @unit
  Scenario: An erased user is cleared from the versions they saved
    Given versions saved by a user in two projects
    When the user is erased
    Then those versions no longer name the user
    And the history shows them as saved by a former member

  # --- Existing datasets ---

  @unit
  Scenario: Existing datasets get version 1 in the background
    Given datasets created before versioning, with no versions
    When the background step "dataset:create-first-versions" runs
    Then each ready dataset has version 1 with the trigger "initial"
    And running the step again creates nothing
    And a dry run creates nothing and saves no checkpoint

  @unit
  Scenario: The first-version step resumes from its checkpoint
    Given the first-version step saved a checkpoint after a page of datasets
    When it runs again from that checkpoint
    Then it continues after the last dataset it finished

  @integration
  Scenario: The memory and Postgres version repositories answer alike
    Given the memory and the Postgres dataset version repositories
    When versions are written, listed, linked to runs and deleted
    Then both answer the same rows, scoped to their project

  # --- History UI ---

  @integration
  Scenario: The history drawer lists versions and saves one by hand
    Given the dataset screen of a dataset with versions
    When the user opens the history
    Then the versions are listed with author and time
    And the user can save a version with an optional name

  @integration
  Scenario: The history drawer compares and restores a version
    Given the history drawer of a dataset with versions 1 and 2
    When the user compares version 1 with the current content
    Then the added, removed and changed rows are shown
    And restoring version 1 asks for confirmation and then writes a new version
