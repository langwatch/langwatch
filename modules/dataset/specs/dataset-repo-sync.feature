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
    Then the answer is 422
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
  Scenario: Upserting by a key column leaves unchanged rows alone
    Given a dataset holds a row whose "case_id" is "c-1"
    When a script upserts the same values for "c-1"
    Then no request writes that row
    And the result counts it as unchanged

  @unit
  Scenario: Upserting by a key column refuses a key that matches more than one row
    # A dataset filled by the old append-only sync holds such rows on its first upsert.
    Given a dataset holds two rows whose "case_id" is "c-1"
    When a script upserts an entry with "case_id" "c-1"
    Then the SDK refuses before writing anything and names the duplicated key
    And the error says to delete the extra rows and upsert again

  @unit
  Scenario: Upserting by a key column refuses two entries with the same key
    When a script upserts two entries whose "case_id" is "c-1"
    Then the SDK refuses before sending any request and names the shared key

  @unit
  Scenario: Upserting by a key column refuses an entry without the key
    When a script upserts an entry that has no "case_id"
    Then the SDK refuses before sending any request
