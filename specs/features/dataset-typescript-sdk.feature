Feature: Dataset TypeScript SDK
  As a TypeScript developer using the LangWatch SDK
  I want full CRUD access to datasets and records through the SDK client
  So that I can programmatically manage datasets without using the REST API directly

  Background:
    Given a LangWatch client initialized with a valid API key
    And the configured project has at least one dataset

  # ── DatasetsFacade Public API ────────────────────────────────────

  @unit
  Scenario: Facade exposes all dataset CRUD methods
    When I inspect langwatch.datasets
    Then it exposes get, list, create, update, delete, createRecords, updateRecord, deleteRecords, upload, and listRecords methods

  # ── List Datasets ───────────────────────────────────────────────

  @integration
  Scenario: List datasets returns paginated results with record counts
    Given the API returns a paginated list of 3 datasets
    When I call langwatch.datasets.list()
    Then I receive a response containing 3 datasets with id, name, slug, columnTypes, and recordCount
    And the response includes pagination with total, page, limit, and totalPages

  @unit
  Scenario: List datasets passes pagination parameters
    Given the API returns page 2 with limit 10
    When I call langwatch.datasets.list({ page: 2, limit: 10 })
    Then the request is sent with page=2 and limit=10 query parameters

  # ── Create Dataset ──────────────────────────────────────────────

  @integration
  Scenario: Create a dataset with name and column types
    Given the API accepts the dataset creation payload
    When I call langwatch.datasets.create({ name: "my-data", columnTypes: [{ name: "input", type: "string" }] })
    Then the request is sent as POST /api/dataset with the name and columnTypes in the body
    And the returned dataset includes id, name, slug, and columnTypes

  @unit
  Scenario: Create a dataset without column types defaults to empty array
    When I call langwatch.datasets.create({ name: "bare-dataset" })
    Then the request body includes columnTypes as an empty array

  @unit
  Scenario: Create a dataset with empty name throws validation error
    When I call langwatch.datasets.create({ name: "" })
    Then the SDK throws a DatasetApiError indicating name is required

  @integration
  Scenario: Create a dataset propagates conflict error
    Given the API responds with 409 Conflict for a duplicate slug
    When I call langwatch.datasets.create({ name: "existing-name" })
    Then the SDK throws a DatasetApiError with status 409

  # ── Get Dataset (existing) ──────────────────────────────────────

  @integration
  Scenario: Get dataset by slug returns metadata and entries
    Given the API returns a dataset with 5 records
    When I call langwatch.datasets.get("my-dataset")
    Then I receive a dataset with id, name, slug, columnTypes, and 5 entries

  @integration
  Scenario: Get non-existent dataset throws DatasetNotFoundError
    Given the API responds with 404
    When I call langwatch.datasets.get("does-not-exist")
    Then the SDK throws a DatasetNotFoundError

  # ── Update Dataset ──────────────────────────────────────────────

  @integration
  Scenario: Update a dataset name
    Given the API accepts the update payload and returns the updated dataset
    When I call langwatch.datasets.update("my-data", { name: "new-name" })
    Then the request is sent as PATCH /api/dataset/my-data with name "new-name"
    And the returned dataset reflects the updated name and slug

  @unit
  Scenario: Update a dataset column types
    When I call langwatch.datasets.update("my-data", { columnTypes: [{ name: "question", type: "string" }] })
    Then the request body includes the new columnTypes

  @unit
  Scenario: Update a dataset with no fields throws validation error
    When I call langwatch.datasets.update("my-data", {})
    Then the SDK throws a DatasetApiError indicating at least one field is required

  @integration
  Scenario: Update a non-existent dataset throws DatasetNotFoundError
    Given the API responds with 404
    When I call langwatch.datasets.update("ghost", { name: "x" })
    Then the SDK throws a DatasetNotFoundError

  # ── Delete Dataset ──────────────────────────────────────────────

  @integration
  Scenario: Delete dataset sends DELETE and returns archived result
    Given the API accepts the delete request and returns the archived dataset
    When I call langwatch.datasets.delete("my-data")
    Then the request is sent as DELETE /api/dataset/my-data
    And the response includes the archived dataset

  @integration
  Scenario: Delete a non-existent dataset throws DatasetNotFoundError
    Given the API responds with 404
    When I call langwatch.datasets.delete("ghost")
    Then the SDK throws a DatasetNotFoundError

  # ── Create Records (Batch) ──────────────────────────────────────

  @integration
  Scenario: Batch create records in a dataset
    Given the API accepts the batch create payload and returns created records
    When I call langwatch.datasets.createRecords("my-data", [{ input: "hello", output: "world" }])
    Then the request is sent as POST /api/dataset/my-data/records with the entries array
    And the response includes the created records with IDs

  @unit
  Scenario: Batch create records with empty entries throws validation error
    When I call langwatch.datasets.createRecords("my-data", [])
    Then the SDK throws a DatasetApiError indicating entries must not be empty

  @integration
  Scenario: Batch create records for non-existent dataset throws error
    Given the API responds with 404
    When I call langwatch.datasets.createRecords("ghost", [{ input: "x" }])
    Then the SDK throws a DatasetNotFoundError

  # ── Update Record ───────────────────────────────────────────────

  @integration
  Scenario: Update a single record
    Given the API accepts the record update and returns the updated record
    When I call langwatch.datasets.updateRecord("my-data", "rec-1", { input: "updated" })
    Then the request is sent as PATCH /api/dataset/my-data/records/rec-1 with the entry
    And the returned record contains the updated entry

  @integration
  Scenario: Update a record for non-existent dataset throws error
    Given the API responds with 404
    When I call langwatch.datasets.updateRecord("ghost", "rec-1", { input: "x" })
    Then the SDK throws a DatasetNotFoundError

  # ── Delete Records ──────────────────────────────────────────────

  @integration
  Scenario: Delete records by IDs
    Given the API accepts the batch delete and returns deletedCount 2
    When I call langwatch.datasets.deleteRecords("my-data", ["rec-1", "rec-2"])
    Then the request is sent as DELETE /api/dataset/my-data/records with recordIds
    And the response includes deletedCount of 2

  @integration
  Scenario: Delete records for non-existent dataset throws error
    Given the API responds with 404
    When I call langwatch.datasets.deleteRecords("ghost", ["rec-1"])
    Then the SDK throws a DatasetNotFoundError

  # ── List Records ───────────────────────────────────────────────

  @integration
  Scenario: List records returns paginated results
    Given the API returns paginated records for a dataset
    When I call langwatch.datasets.listRecords("my-data")
    Then I receive records with pagination metadata including total, page, limit, and totalPages

  @integration
  Scenario: List records with explicit pagination
    When I call langwatch.datasets.listRecords("my-data", { page: 2, limit: 20 })
    Then the request includes page=2 and limit=20 query parameters

  @integration
  Scenario: List records for non-existent dataset throws error
    Given the API responds with 404
    When I call langwatch.datasets.listRecords("ghost")
    Then the SDK throws a DatasetNotFoundError

  # ── Upload (unified with ifExists strategy) ────────────────────

  @integration
  Scenario: Upload with append strategy appends to existing dataset
    Given the API accepts the file upload
    When I call langwatch.datasets.upload("existing-data", file)
    Then the file is uploaded to the existing dataset

  @integration
  Scenario: Upload with append strategy creates dataset if not found
    Given the API responds with 404 for upload, then accepts create-from-file
    When I call langwatch.datasets.upload("new-data", file)
    Then the SDK creates the dataset from the file

  @integration
  Scenario: Upload with replace strategy deletes records then uploads
    Given the dataset has existing records
    When I call langwatch.datasets.upload("my-data", file, { ifExists: "replace" })
    Then all existing records are deleted before uploading

  @integration
  Scenario: Upload with error strategy throws if dataset exists
    Given the dataset exists
    When I call langwatch.datasets.upload("my-data", file, { ifExists: "error" })
    Then the SDK throws a DatasetApiError with status 409

  # ── Error Mapping ───────────────────────────────────────────────

  @unit
  Scenario: SDK maps 404 responses to DatasetNotFoundError
    Given an API response with status 404
    When the DatasetService processes the response
    Then it throws a DatasetNotFoundError with the slug in the message

  @unit
  Scenario: SDK maps 409 responses to DatasetApiError with status
    Given an API response with status 409 and message "A dataset with this slug already exists"
    When the DatasetService processes the response
    Then it throws a DatasetApiError with status 409 and the conflict message

  @unit
  Scenario: SDK maps 403 responses to DatasetPlanLimitError with upgrade message
    Given an API response with status 403 and a plan limit exceeded message
    When the DatasetService processes the response
    Then it throws a DatasetPlanLimitError with the limit details and upgrade URL

  @unit
  Scenario: SDK maps unexpected errors to DatasetApiError with status code
    Given an API response with status 500 and message "Internal error"
    When the DatasetService processes the response
    Then it throws a DatasetApiError with status 500

