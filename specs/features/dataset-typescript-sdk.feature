Feature: Dataset TypeScript SDK
  As a TypeScript developer using the LangWatch SDK
  I want full CRUD access to datasets and records through the SDK client
  So that I can programmatically manage datasets without using the REST API directly

  # 32 of 32 scenarios bound to integration/unit tests in
  # sdks/typescript/src/client-sdk/services/datasets/__tests__/.

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

  # ── Get Dataset: paged read ─────────────────────────────────────
  # datasets.get() reads the entries from the records endpoint page by page,
  # so the size of a dataset is not bound by what one response can hold. Each
  # page also carries the dataset's metadata. A server that does not send it is
  # asked through the datasets list, then through the single request.

  @unit
  Scenario: datasets.get reads a dataset larger than the single response limit page by page
    Given a dataset whose rows add up to more than one response can hold
    When I call langwatch.datasets.get("product-images")
    Then I receive every row in its original order
    And the metadata comes from the records page
    And the dataset was never asked for in a single response

  @unit
  Scenario: datasets.get keeps the shape of the single response
    Given a dataset "product-images" exists with 3 records
    When I call langwatch.datasets.get("product-images")
    Then I receive the id, name, slug, columnTypes and timestamps the single response gives
    And every entry has the fields the single response gives it

  @unit
  Scenario: datasets.get by id reads the same dataset page by page
    Given a dataset with slug "product-images" and id "dataset_images" exists
    When I call langwatch.datasets.get("dataset_images")
    Then I receive the dataset "product-images" with every row

  @unit
  Scenario: datasets.get follows the page size a refusal suggests
    Given the server refuses a page of rows as too large and suggests a smaller page size
    When I call langwatch.datasets.get("product-images")
    Then the SDK asks again for the same rows with the suggested page size
    And I receive every row in its original order

  @unit
  Scenario: datasets.get finds the metadata in the datasets list on a server that sends none with its pages
    Given a server whose records pages do not carry the dataset
    When I call langwatch.datasets.get("product-images")
    Then the dataset's id, name and slug come from the datasets list
    And the dataset was never asked for in a single response

  @unit
  Scenario: datasets.get throws the server's refusal when only the single request can name the dataset
    Given a server whose records pages and datasets list do not name the dataset
    And the dataset is too large for the single response
    When I call langwatch.datasets.get("product-images")
    Then the SDK throws a DatasetApiError with status 400 that carries the server's refusal
    And no partial dataset is returned

  @unit
  Scenario: datasets.get asks for fewer rows when the server refuses a page as too large
    Given the server refuses a page of rows as too large without suggesting a page size
    When I call langwatch.datasets.get("product-images")
    Then the SDK asks again for the same rows with half the page size until a page is accepted
    And I receive every row in its original order

  @unit
  Scenario: datasets.get reads one oversized row alone and returns to larger pages
    Given a dataset whose first row is as large as a whole page may be
    When I call langwatch.datasets.get("product-images")
    Then the first row is read in a page of its own
    And the following small rows are read in large pages again

  @unit
  Scenario: datasets.get throws the refusal when a single row is too large to read
    Given a server that refuses even a page that holds only one row
    When I call langwatch.datasets.get("product-images")
    Then the SDK throws a DatasetApiError with status 413

  @unit
  Scenario: datasets.get falls back to the single request on a server without the records endpoint
    Given a self-hosted server that has no records endpoint
    When I call langwatch.datasets.get("product-images")
    Then the dataset is read with the single request
    And I receive every row

  @unit
  Scenario: datasets.get throws not found when neither request finds the dataset
    When I call langwatch.datasets.get("does-not-exist")
    Then the SDK throws a DatasetNotFoundError

  @unit
  Scenario: datasets.get stops when rows are removed while it is reading
    Given rows are removed from the dataset after the first page was read
    When I call langwatch.datasets.get("product-images")
    Then the read ends at the first page that comes back short

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

