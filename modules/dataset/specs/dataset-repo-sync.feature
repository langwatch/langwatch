Feature: Keeping a dataset in sync with files held in a repository
  As a team that keeps its datasets as files in a repository
  I want a script to create and update those datasets through the API or an SDK
  So that the platform matches the repository with no step done by hand

  # Two things a sync needs. The first run creates the dataset with its columns
  # and rows in one call. Every later run sends the rows again: a row whose key
  # column already holds that value is updated in place, a new key adds a row,
  # and an unchanged row is left alone. Record ids are global, so a sync matches
  # rows on a column it chooses, never on an id it makes up.

  # ── Create with columns and rows ───────────────────────────────

  @unit
  Scenario: A dataset is created over REST with its columns and first rows in one call
    When a client posts to /api/dataset a name, column types and two entries
    Then the answer is 201 with the dataset
    And the application creates the dataset with those columns and both rows in one operation

  @unit
  Scenario: Creating a dataset over REST refuses a row with a column the dataset does not define
    When a client posts to /api/dataset entries holding a column missing from the column types
    Then the answer is 422 with code "validation_error"
    And no dataset is created

  @unit
  Scenario: Creating a dataset over REST refuses more first rows than the plan's batch bound
    Given a project on the free plan, whose batch bound is 1000 rows
    When a client posts to /api/dataset 1001 entries
    Then the application refuses with code "dataset_batch_too_large"
    And no dataset is created

  @unit
  Scenario: The SDKs create a dataset with its columns and rows in one call
    When a script creates a dataset with columns and records through the Python or TypeScript SDK
    Then one request is sent to POST /api/v1/dataset carrying the column types and the entries

  # ── Upsert by a key column ─────────────────────────────────────

  @unit
  Scenario: Upserting by a key column updates the matching row instead of appending a copy
    Given a dataset holds a row whose "case_id" is "c-1"
    When a script upserts an entry with "case_id" "c-1" and a new expected output
    Then that row is updated in place through its record id
    And the dataset still holds one row for "c-1"

  @unit
  Scenario: Upserting by a key column adds the rows whose key is new
    Given a dataset holds no row whose "case_id" is "c-9"
    When a script upserts an entry with "case_id" "c-9"
    Then the entry is created as a new row in one batch request

  @unit
  Scenario: Upserting more new keys than one batch carries sends one batch create per 1000 rows
    # 1000 is the smallest batch any plan accepts.
    When a script upserts 2500 entries whose keys are all new
    Then the SDK sends three batch creates of 1000, 1000 and 500 rows

  @unit
  Scenario: Upserting by a key column leaves unchanged rows alone
    Given a dataset holds a row whose "case_id" is "c-1"
    When a script upserts the same values for "c-1"
    Then no request writes that row
    And the result counts it as unchanged

  @unit
  Scenario: Upserting a value that differs only in its JSON type updates the row
    Given a dataset holds a row whose "input" is false
    When a script upserts the same row with "input" 0
    Then that row is updated in place

  @unit
  Scenario: Upserting by a key column refuses a key that matches more than one row
    # A dataset filled by the old append-only sync holds such rows on its first upsert.
    Given a dataset holds two rows whose "case_id" is "c-1"
    When a script upserts an entry with "case_id" "c-1"
    Then the SDK refuses with code "dataset_has_duplicate_key" before writing anything

  @unit
  Scenario: Upserting by a key column refuses two entries with the same key
    When a script upserts two entries whose "case_id" is "c-1", or two equal objects with keys in another order
    Then the SDK refuses with code "duplicate_upsert_key" before sending any request

  @unit
  Scenario: Upserting by a key column refuses an entry without the key
    When a script upserts an entry that has no "case_id", or one whose "case_id" would not reach the wire
    Then the SDK refuses with code "missing_upsert_key" before sending any request

  @unit
  Scenario: Upserting no entries still refuses a dataset that does not exist
    When a script upserts no entries into a dataset slug that does not exist
    Then the SDK refuses with a dataset not found error
