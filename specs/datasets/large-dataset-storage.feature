Feature: Large dataset storage
  As a user with large datasets
  I want to upload, store, and use multi-GB datasets
  So that I am not blocked by the old upload limits and everything that uses datasets keeps working

  # Behaviour derived from ADR-032 (dev/docs/adr/032-datasets-s3-jsonl.md).
  # Scenarios describe what the user observes, not how storage is implemented.
  # Scenarios are @unimplemented until their rung ships (tracked by #4897);
  # each gains a @scenario-bound test as the rung lands.

  Background:
    Given I am logged in
    And I have access to a project

  # ============================================================================
  # Uploading large files
  # ============================================================================

  @integration @unimplemented
  Scenario: A large file uploads without freezing the app
    When I upload a large dataset file
    Then the upload succeeds
    And the app stays responsive during the upload
    And the dataset shows as "processing" while it is prepared
    And the dataset becomes "ready" once preparation finishes

  @unit
  Scenario: Both CSV and JSONL files are accepted
    When I upload a dataset as a CSV file
    Then once ready it has the expected rows and columns
    When I upload a dataset as a JSONL file
    Then once ready it has the expected rows and columns

  @unit
  Scenario: A ready dataset reports its true row count and size
    When I upload a dataset of 50 rows
    Then once ready the dataset reports 50 rows
    And the dataset reports its stored size

  @unit
  Scenario: A new dataset is created directly in object storage
    When I create a new dataset
    Then its rows are stored in object storage as chunks
    And its rows are not stored in the Postgres records table
    And the dataset is immediately ready to read

  @integration
  Scenario: A dataset still being prepared is not used as data
    Given a dataset that is still processing
    When an experiment, the SDK, or the UI reads that dataset
    Then it is treated as not ready
    And no partial or half-prepared rows are ever served

  @integration
  Scenario: Appending rows adds new data and preserves existing rows
    Given a ready dataset with 10 rows
    When I append 5 more rows
    Then the dataset reports 15 rows
    And the original 10 rows are unchanged

  @integration
  Scenario: Dataset access is isolated to its own project
    When I upload a dataset to my project
    Then I can read it from my project
    And it is not accessible from another project
    And I cannot upload into another project's dataset

  # ============================================================================
  # Recovery
  # ============================================================================

  @unit
  Scenario: An interrupted preparation loses nothing and can be retried
    Given a dataset whose preparation was interrupted before it finished
    Then nothing I uploaded is lost
    And the dataset is still shown as not ready
    When I retry the preparation
    Then the dataset becomes ready with the correct rows

  @unit
  Scenario: Retrying preparation does not duplicate rows
    Given a dataset whose preparation was interrupted after some rows were prepared
    When I retry the preparation
    Then the dataset reports the correct row count with no duplicates

  # ============================================================================
  # Consumers keep working
  # ============================================================================

  @integration @unimplemented
  Scenario: Experiments and the SDK read a dataset the same as before
    Given a ready dataset
    When an experiment or the SDK reads the dataset
    Then it receives the dataset rows the same as before

  # ============================================================================
  # Migration of existing datasets
  # ============================================================================

  @integration
  Scenario: An existing dataset stays usable after the storage migration
    Given a dataset created before the storage migration
    When the migration runs
    Then reading the dataset returns the same rows as before

  @integration
  Scenario: The storage migration is safe to run more than once
    Given a dataset that has already been migrated
    When the migration runs again
    Then the dataset is unchanged, with no duplicated or lost rows

  @integration @unimplemented
  Scenario: A dataset stays readable while the migration is in progress
    Given a migration that has not yet finished
    When I read a dataset
    Then it still returns its rows

  @unit
  Scenario: A very large dataset migrates without loading every row at once
    Given a dataset with more rows than fit comfortably in memory
    When the migration runs
    Then its rows are migrated by streaming them in pages
    And memory use stays bounded regardless of how large the dataset is
    And every row keeps the same identity after the migration

  @unit
  Scenario: A legacy single-blob dataset is left readable, not emptied
    Given a dataset stored in the older single-file format
    When the migration runs
    Then that dataset is skipped and left on the legacy format
    And it stays fully readable rather than being turned into an empty dataset

  # ============================================================================
  # Self-hosted
  # ============================================================================

  @unit
  Scenario: Datasets work on a minimal self-hosted install
    Given a self-hosted install without extra storage set up
    When I create and read a dataset
    Then it works
    And the application still starts normally

  @unit
  Scenario: A large file uploads on a self-hosted install with no object storage
    Given a self-hosted install without object storage (local filesystem only)
    When I upload a CSV larger than the in-browser limit
    Then the upload is accepted without a "requires object storage" error
    And the file is streamed to storage rather than parsed in the browser
    And the dataset becomes ready once it finishes preparing

  # ============================================================================
  # Editing
  # ============================================================================

  @integration
  Scenario: Editing or deleting a row updates only that row
    Given a ready dataset with several rows
    When I edit one row and delete another
    Then those changes are saved
    And the other rows are unaffected

  # ADR-032 v19: changing a column's type on a stored dataset re-converts the
  # stored values to the new type — previously refused for large (S3) datasets.
  @integration
  Scenario: Changing a column's type re-converts the stored values
    Given a ready dataset whose "score" column is stored as text
    When I edit the dataset and change "score" to a number
    Then the dataset's "score" column is reported as a number
    And the stored values are converted to numbers
    And the other columns and rows are unchanged

  @integration
  Scenario: Retyping a text column to an image URL keeps the value
    Given a ready dataset with a column of base64 data URLs stored as text
    When I edit the dataset and change that column to an image
    Then the column is reported as an image
    And each stored data URL is kept exactly as it was
