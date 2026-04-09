Feature: Dataset REST API
  As an API consumer (SDK, CLI, or AI agent)
  I want full CRUD access to datasets and records via REST endpoints
  So that I can programmatically manage datasets without the UI

  Background:
    Given a project with a valid API key in the X-Auth-Token header

  # ── List Datasets ──────────────────────────────────────────────

  @integration
  Scenario: List datasets returns paginated non-archived datasets
    Given the project has 3 datasets and 1 archived dataset
    When I call GET /api/dataset
    Then I receive a paginated response with 3 datasets
    And each dataset includes id, name, slug, columnTypes, and record count
    And the archived dataset is not included

  @integration
  Scenario: List datasets with page and limit parameters
    Given the project has 15 datasets
    When I call GET /api/dataset?page=2&limit=5
    Then I receive 5 datasets from the second page
    And the response includes pagination metadata with total count

  @integration
  Scenario: List datasets returns empty array for project with no datasets
    When I call GET /api/dataset
    Then I receive a paginated response with 0 datasets

  # ── Create Dataset ─────────────────────────────────────────────

  @integration
  Scenario: Create a dataset with name and column types
    When I call POST /api/dataset with name "User Feedback" and columnTypes [{"name": "input", "type": "string"}, {"name": "output", "type": "string"}]
    Then a new dataset is created
    And the slug is "user-feedback"
    And the response includes the dataset id, name, slug, and columnTypes

  @integration
  Scenario: Create a dataset auto-generates a unique slug from the name
    Given a dataset named "Test Data" already exists
    When I call POST /api/dataset with name "Test Data"
    Then the request fails with 409 Conflict
    And the error indicates a dataset with that slug already exists

  @integration
  Scenario: Create a dataset enforces plan limits
    Given the project has reached its dataset plan limit
    When I call POST /api/dataset with name "One More"
    Then the request fails with 403 Forbidden
    And the error indicates the dataset limit has been reached

  @integration
  Scenario: Create a dataset validates column types
    When I call POST /api/dataset with columnTypes [{"name": "col1", "type": "invalid_type"}]
    Then the request fails with 422 Unprocessable Entity
    And the error indicates the column type is invalid

  @integration
  Scenario: Create a dataset requires a name
    When I call POST /api/dataset without a name
    Then the request fails with 422 Unprocessable Entity

  # ── Get Single Dataset ─────────────────────────────────────────

  @integration
  Scenario: Get a dataset by slug
    Given a dataset with slug "my-dataset" exists
    When I call GET /api/dataset/my-dataset
    Then I receive the dataset with its records
    And the response includes id, name, slug, and columnTypes

  @integration
  Scenario: Get a dataset by id
    Given a dataset with id "dataset_abc123" exists
    When I call GET /api/dataset/dataset_abc123
    Then I receive the dataset with its records

  @integration
  Scenario: Get dataset returns 404 for non-existent slug
    When I call GET /api/dataset/does-not-exist
    Then the request fails with 404 Not Found

  @integration
  Scenario: Get dataset enforces 25MB response size limit
    Given a dataset with records exceeding 25MB total
    When I call GET /api/dataset/large-dataset
    Then the request fails with 400 Bad Request
    And the error indicates the response size exceeds the limit

  # ── Update Dataset ─────────────────────────────────────────────

  @integration
  Scenario: Update a dataset name and column types
    Given a dataset with slug "old-name" exists
    When I call PATCH /api/dataset/old-name with name "New Name" and columnTypes [{"name": "question", "type": "string"}]
    Then the dataset is updated
    And the slug changes to "new-name"
    And the response reflects the updated name and columnTypes

  @integration
  Scenario: Update a dataset name regenerates the slug
    Given a dataset with slug "original" exists
    When I call PATCH /api/dataset/original with name "Renamed Dataset"
    Then the slug changes to "renamed-dataset"

  @integration
  Scenario: Update a dataset fails when new slug conflicts
    Given datasets "alpha" and "beta" exist
    When I call PATCH /api/dataset/alpha with name "Beta"
    Then the request fails with 409 Conflict

  @integration
  Scenario: Update a non-existent dataset returns 404
    When I call PATCH /api/dataset/ghost with name "Whatever"
    Then the request fails with 404 Not Found

  @integration
  Scenario: Update dataset does not enforce plan limits
    Given the project has reached its dataset plan limit
    And a dataset with slug "existing" exists
    When I call PATCH /api/dataset/existing with name "Updated Name"
    Then the dataset is updated successfully

  # ── Delete (Archive) Dataset ───────────────────────────────────

  @integration
  Scenario: Delete a dataset archives it
    Given a dataset with slug "to-delete" exists
    When I call DELETE /api/dataset/to-delete
    Then the dataset is soft-deleted with an archivedAt timestamp
    And the slug is modified to prevent future conflicts
    And subsequent GET /api/dataset/to-delete returns 404

  @integration
  Scenario: Delete a non-existent dataset returns 404
    When I call DELETE /api/dataset/nope
    Then the request fails with 404 Not Found

  # ── List Records ───────────────────────────────────────────────

  @integration
  Scenario: List records with default pagination
    Given a dataset "my-dataset" has 100 records
    When I call GET /api/dataset/my-dataset/records
    Then I receive the first page of records with pagination metadata
    And the total count is 100

  @integration
  Scenario: List records with explicit pagination
    Given a dataset "my-dataset" has 100 records
    When I call GET /api/dataset/my-dataset/records?page=3&limit=20
    Then I receive 20 records from the third page
    And the response includes pagination metadata

  @integration
  Scenario: List records for non-existent dataset returns 404
    When I call GET /api/dataset/ghost/records
    Then the request fails with 404 Not Found

  # ── Batch Create Records ──────────────────────────────────────

  @integration
  Scenario: Batch create records via POST /:slugOrId/records
    Given a dataset "my-dataset" with columns [input, output]
    When I call POST /api/dataset/my-dataset/records with entries [{"input": "hello", "output": "world"}]
    Then the records are created with unique IDs
    And the response includes the created records with their IDs

  @integration
  Scenario: Batch create records accepts dataset ID as well as slug
    Given a dataset with slug "my-data" and id "dataset_xyz" with columns [input]
    When I call POST /api/dataset/dataset_xyz/records with entries [{"input": "test"}]
    Then the records are created for the matching dataset

  @integration
  Scenario: Batch create records validates column names against dataset schema
    Given a dataset "my-dataset" with columns [input, output]
    When I call POST /api/dataset/my-dataset/records with entries [{"input": "hi", "foo": "bar"}]
    Then the request fails with 400 Bad Request
    And the error identifies "foo" as an invalid column

  @integration
  Scenario: Batch create records allows entries with subset of columns
    Given a dataset "my-dataset" with columns [input, output]
    When I call POST /api/dataset/my-dataset/records with entries [{"input": "hi"}]
    Then the records are created successfully
    And the missing column "output" defaults to null

  @integration
  Scenario: Batch create records returns 404 for non-existent dataset
    When I call POST /api/dataset/ghost/records with entries [{"input": "hello"}]
    Then the request fails with 404 Not Found

  @integration
  Scenario: Batch create records requires entries in body
    Given a dataset "my-dataset" exists
    When I call POST /api/dataset/my-dataset/records with an empty body
    Then the request fails with 422 Unprocessable Entity

  @integration
  Scenario: Batch create records enforces maximum batch size
    Given a dataset "my-dataset" with columns [input]
    When I call POST /api/dataset/my-dataset/records with more than 1000 entries
    Then the request fails with 422 Unprocessable Entity
    And the error indicates the batch size limit

  # ── Update Record ──────────────────────────────────────────────

  @integration
  Scenario: Update a record entry
    Given a dataset "my-dataset" has a record "rec-123" with entry {"input": "hello"}
    When I call PATCH /api/dataset/my-dataset/records/rec-123 with entry {"input": "updated"}
    Then the record entry is updated to {"input": "updated"}

  @integration
  Scenario: Update a non-existent record creates it
    Given a dataset "my-dataset" exists with no record "rec-new"
    When I call PATCH /api/dataset/my-dataset/records/rec-new with entry {"input": "new"}
    Then the record is created with the given entry

  @integration
  Scenario: Update a record for non-existent dataset returns 404
    When I call PATCH /api/dataset/ghost/records/rec-1 with entry {"input": "x"}
    Then the request fails with 404 Not Found

  # ── Delete Records (Batch) ─────────────────────────────────────

  @integration
  Scenario: Delete records in batch
    Given a dataset "my-dataset" has records "rec-1", "rec-2", "rec-3"
    When I call DELETE /api/dataset/my-dataset/records with recordIds ["rec-1", "rec-2"]
    Then those 2 records are deleted
    And the response includes the deleted count

  @integration
  Scenario: Delete records with no matching IDs returns 404
    Given a dataset "my-dataset" exists
    When I call DELETE /api/dataset/my-dataset/records with recordIds ["nonexistent"]
    Then the request fails with 404 Not Found
    And the error indicates no matching records found

  @integration
  Scenario: Delete records for non-existent dataset returns 404
    When I call DELETE /api/dataset/ghost/records with recordIds ["rec-1"]
    Then the request fails with 404 Not Found

  @integration
  Scenario: Delete records requires recordIds in body
    Given a dataset "my-dataset" exists
    When I call DELETE /api/dataset/my-dataset/records with an empty body
    Then the request fails with 422 Unprocessable Entity

  # ── Authentication ─────────────────────────────────────────────

  @integration
  Scenario: Request without API key returns 401
    When I call any dataset endpoint without X-Auth-Token header
    Then the request fails with 401 Unauthorized

  @integration
  Scenario: Request with invalid API key returns 401
    When I call any dataset endpoint with an invalid X-Auth-Token
    Then the request fails with 401 Unauthorized

  # ── Cross-Cutting: Slug or ID Resolution ───────────────────────

  @integration
  Scenario: Endpoints accept both slug and dataset ID
    Given a dataset with slug "my-data" and id "dataset_xyz"
    When I call GET /api/dataset/my-data
    And I call GET /api/dataset/dataset_xyz
    Then both requests return the same dataset
