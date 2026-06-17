Feature: Large dataset storage
  As a user with large datasets
  I want to upload, store, and use multi-GB datasets
  So that I am not blocked by the old upload limits and everything that uses datasets keeps working

  # Behaviour derived from ADR-032 (dev/docs/adr/032-datasets-s3-jsonl.md).
  # Dataset content lives in object storage; Postgres keeps the metadata and
  # column types. This changes how data is STORED, not how it is USED.

  Background:
    Given I am logged in
    And I have access to a project

  # ============================================================================
  # Uploading large files
  # ============================================================================

  @integration
  Scenario: A large file uploads directly to object storage
    When I upload a large dataset file
    Then the file is sent straight to object storage without streaming through the app server
    And the browser does not have to parse the whole file first
    And the dataset is created in a "processing" state while it is prepared
    And the dataset becomes "ready" once preparation finishes

  @integration
  Scenario: Both CSV and JSONL files are accepted
    When I upload a dataset as a CSV file
    Then once ready it has the expected rows and columns
    When I upload a dataset as a JSONL file
    Then once ready it has the expected rows and columns

  @integration
  Scenario: A ready dataset reports its true row count and size
    When I upload a dataset of 50 rows
    Then once ready the dataset reports 50 rows
    And the dataset reports a stored size in bytes

  @integration
  Scenario: A dataset still being prepared is not used as data
    Given a dataset that is still processing
    When an experiment, the SDK, or the UI reads that dataset
    Then it is treated as not ready
    And no partial or half-prepared rows are ever served

  @integration
  Scenario: Appending rows extends a dataset without rewriting it
    Given a ready dataset with 10 rows
    When I append 5 more rows
    Then the dataset reports 15 rows
    And the existing 10 rows are unchanged

  @integration
  Scenario: Dataset content is isolated to its own project
    When I upload a dataset to my project
    Then its content is stored under my project only
    And I cannot upload content into another project's dataset

  # ============================================================================
  # Recovery
  # ============================================================================

  @integration
  Scenario: An interrupted preparation loses nothing and can be retried
    Given a dataset whose preparation was interrupted before it finished
    Then nothing I uploaded is lost
    And the dataset is still shown as not ready
    When I retry the preparation
    Then the dataset becomes ready with the correct rows

  @integration
  Scenario: Retrying preparation does not duplicate rows
    Given a dataset whose preparation was interrupted after some rows were written
    When I retry the preparation
    Then the dataset reports the correct row count with no duplicates

  # ============================================================================
  # Consumers keep working (storage changes, usage does not)
  # ============================================================================

  @integration
  Scenario: Experiments and the SDK read an object-storage dataset the same as before
    Given a ready dataset stored in object storage
    When an experiment or the SDK reads the dataset
    Then it receives the dataset rows through the same interface as before

  # ============================================================================
  # Migration of existing datasets
  # ============================================================================

  @integration
  Scenario: An existing Postgres dataset becomes available from object storage after migration
    Given a dataset created before the move to object storage
    When the migration runs
    Then the dataset's content is available from object storage
    And reading it returns the same rows as before

  @integration
  Scenario: Migration is safe to run more than once
    Given a dataset that has already been migrated
    When the migration runs again
    Then the dataset is left unchanged with no duplicated or lost rows

  @integration
  Scenario: A dataset stays readable while migration is in progress
    Given a migration that has not yet finished
    When I read a dataset that has not been migrated yet
    Then it still returns its rows
    And no dataset content is removed before its move is confirmed

  # ============================================================================
  # Self-hosted without object storage
  # ============================================================================

  @integration
  Scenario: Datasets keep working when object storage is not configured
    Given an instance with no object storage configured
    When I create and read a dataset
    Then it works
    And application startup is not affected

  # ============================================================================
  # Editing
  # ============================================================================

  @integration
  Scenario: Editing or deleting a row updates only that row
    Given a ready dataset with several rows
    When I edit one row and delete another
    Then those changes are saved
    And the other rows are unaffected
