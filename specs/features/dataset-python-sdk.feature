Feature: Dataset Python SDK
  As a Python developer using the LangWatch SDK
  I want CRUD methods for datasets and records in the Python SDK
  So that I can manage datasets programmatically without using the UI or raw HTTP calls

  Background:
    Given the LangWatch SDK is initialized with a valid API key

  # ── Design Decisions ─────────────────────────────────────────
  #
  # Architecture: Follows the prompts module 3-layer pattern:
  #   DatasetsFacade  → high-level coordination, error handling
  #   DatasetApiService → pure HTTP operations (hand-rolled httpx)
  #   Domain models   → Dataset, DatasetInfo, DatasetEntry, DatasetRecord (Pydantic)
  #
  # HTTP calls: Hand-rolled httpx via rest_api_client.get_httpx_client()
  # (like experiment module), since the generated OpenAPI client only
  # covers 2 of 9 dataset endpoints. DatasetApiService encapsulates all
  # raw HTTP calls using _raise_for_api_status() for error surfacing.
  #
  # Error handling: Custom error hierarchy (mirrors TypeScript SDK):
  #   - DatasetNotFoundError for 404
  #   - DatasetPlanLimitError for 403 (resourceLimitMiddleware)
  #   - DatasetApiError for 400/401/403/409/422/5xx (HTTP errors)
  #   - ValueError / FileNotFoundError for client-side validation
  #
  # Initialization: from_global() classmethod + ensure_setup() pattern
  # (like PromptsFacade.from_global). Module-level __getattr__ exposes
  # a cached DatasetsFacade instance for langwatch.dataset.method() usage.
  #
  # Pydantic models: BaseModel with ConfigDict(extra="ignore") for
  # response types. TypedDict for column type inputs.
  #
  # Tracing: OpenTelemetry decorators on DatasetApiService methods.
  #
  # Pagination: list_datasets() accepts optional page/limit params and
  # returns a PaginatedResult with .data and .pagination. No auto-
  # pagination — users paginate explicitly.
  #
  # Async: Deferred to a future issue. All methods are synchronous.
  #
  # pandas: Lazy import inside to_pandas() only.

  # ── List Datasets ──────────────────────────────────────────────

  @integration
  Scenario: List datasets returns first page for the project
    Given the project has 3 datasets
    When I call langwatch.dataset.list_datasets()
    Then I receive a result with 3 DatasetInfo objects in .data
    And each DatasetInfo includes id, name, slug, and columnTypes
    And the result includes .pagination with total, page, limit, and totalPages

  @integration
  Scenario: List datasets with explicit pagination
    Given the project has 15 datasets
    When I call langwatch.dataset.list_datasets(page=2, limit=5)
    Then I receive 5 DatasetInfo objects from the second page
    And .pagination.total is 15

  @integration
  Scenario: List datasets returns empty result when project has no datasets
    Given the project has no datasets
    When I call langwatch.dataset.list_datasets()
    Then .data is an empty list
    And .pagination.total is 0

  @integration
  Scenario: List datasets propagates authentication errors
    Given the SDK is initialized with an invalid API key
    When I call langwatch.dataset.list_datasets()
    Then a DatasetApiError is raised indicating authentication failed

  # ── Create Dataset ─────────────────────────────────────────────

  @integration
  Scenario: Create a dataset with name and column types
    When I call langwatch.dataset.create_dataset(name="User Feedback", columns=[{"name": "input", "type": "string"}, {"name": "output", "type": "string"}])
    Then a DatasetInfo is returned with name "User Feedback" and slug "user-feedback"
    And the DatasetInfo has the specified column types

  @integration
  Scenario: Create a dataset with only a name returns no column types
    When I call langwatch.dataset.create_dataset(name="Simple Dataset")
    Then a DatasetInfo is returned with name "Simple Dataset"
    And columnTypes is an empty list

  @integration
  Scenario: Create a dataset with a conflicting name raises an error
    Given a dataset named "Existing" already exists
    When I call langwatch.dataset.create_dataset(name="Existing")
    Then a DatasetApiError is raised indicating a conflict

  @unit
  Scenario: Create dataset validates that name is not empty
    When I call langwatch.dataset.create_dataset(name="")
    Then a ValueError is raised indicating name is required

  # ── Get Dataset (existing) ─────────────────────────────────────

  @integration
  Scenario: Get dataset returns dataset with entries
    Given a dataset "my-dataset" exists with 5 records
    When I call langwatch.dataset.get_dataset("my-dataset")
    Then a Dataset object is returned with 5 entries
    And each entry has an id and an entry dict

  @integration
  Scenario: Get dataset by ID works the same as by slug
    Given a dataset with slug "my-data" and id "dataset_xyz" exists
    When I call langwatch.dataset.get_dataset("dataset_xyz")
    Then a Dataset object for "my-data" is returned

  @integration
  Scenario: Get non-existent dataset raises an error
    When I call langwatch.dataset.get_dataset("does-not-exist")
    Then a DatasetNotFoundError is raised

  # ── Update Dataset ─────────────────────────────────────────────

  @integration
  Scenario: Update a dataset name
    Given a dataset with slug "old-name" exists
    When I call langwatch.dataset.update_dataset("old-name", name="New Name")
    Then the returned DatasetInfo has name "New Name" and slug "new-name"

  @integration
  Scenario: Update a dataset column types
    Given a dataset "my-dataset" exists
    When I call langwatch.dataset.update_dataset("my-dataset", columns=[{"name": "question", "type": "string"}])
    Then the returned DatasetInfo has the updated column types

  @integration
  Scenario: Update a non-existent dataset raises an error
    When I call langwatch.dataset.update_dataset("ghost", name="Whatever")
    Then a DatasetNotFoundError is raised

  # ── Delete Dataset ─────────────────────────────────────────────

  @integration
  Scenario: Delete a dataset archives it
    Given a dataset "to-delete" exists
    When I call langwatch.dataset.delete_dataset("to-delete")
    Then the operation completes without error

  @integration
  Scenario: Delete a non-existent dataset raises an error
    When I call langwatch.dataset.delete_dataset("nope")
    Then a DatasetNotFoundError is raised

  # ── List Records ──────────────────────────────────────────────

  @integration
  Scenario: List records returns paginated records for a dataset
    Given a dataset "my-dataset" exists with 10 records
    When I call langwatch.dataset.list_records("my-dataset")
    Then I receive a PaginatedResult with DatasetRecord items in .data
    And the result includes .pagination with total, page, limit, and totalPages

  @integration
  Scenario: List records with explicit pagination
    Given a dataset "my-dataset" exists with 100 records
    When I call langwatch.dataset.list_records("my-dataset", page=2, limit=20)
    Then I receive 20 DatasetRecord items from the second page

  @integration
  Scenario: List records for non-existent dataset raises an error
    When I call langwatch.dataset.list_records("ghost")
    Then a DatasetNotFoundError is raised

  # ── Create Records (Batch Add) ─────────────────────────────────

  @integration
  Scenario: Add records to an existing dataset
    Given a dataset "my-dataset" exists with columns [{"name": "input", "type": "string"}, {"name": "output", "type": "string"}]
    When I call langwatch.dataset.create_records("my-dataset", entries=[{"input": "hello", "output": "hi"}, {"input": "bye", "output": "goodbye"}])
    Then a list of 2 DatasetRecord objects is returned with generated IDs

  @integration
  Scenario: Add records to a non-existent dataset raises an error
    When I call langwatch.dataset.create_records("ghost", entries=[{"input": "x"}])
    Then a DatasetNotFoundError is raised

  @unit
  Scenario: Create records validates entries is not empty
    When I call langwatch.dataset.create_records("my-dataset", entries=[])
    Then a ValueError is raised indicating entries must not be empty

  # ── Update Record ───────────────────────────────────────────────

  @integration
  Scenario: Update a single record
    Given a dataset "my-dataset" has a record "rec-1" with entry {"input": "old"}
    When I call langwatch.dataset.update_record("my-dataset", "rec-1", entry={"input": "updated"})
    Then the returned DatasetRecord has entry {"input": "updated"}

  @integration
  Scenario: Update a non-existent record creates it
    Given a dataset "my-dataset" exists
    When I call langwatch.dataset.update_record("my-dataset", "rec-new", entry={"input": "new"})
    Then a DatasetRecord is returned with id "rec-new" and the given entry

  @integration
  Scenario: Update a record for non-existent dataset raises an error
    When I call langwatch.dataset.update_record("ghost", "rec-1", entry={"input": "x"})
    Then a DatasetNotFoundError is raised

  # ── Delete Records (Batch) ─────────────────────────────────────

  @integration
  Scenario: Delete records by IDs
    Given a dataset "my-dataset" has records "rec-1", "rec-2", "rec-3"
    When I call langwatch.dataset.delete_records("my-dataset", record_ids=["rec-1", "rec-2"])
    Then the result indicates 2 records were deleted

  @integration
  Scenario: Delete records for non-existent dataset raises an error
    When I call langwatch.dataset.delete_records("ghost", record_ids=["rec-1"])
    Then a DatasetNotFoundError is raised

  @unit
  Scenario: Delete records validates record_ids is not empty
    When I call langwatch.dataset.delete_records("my-dataset", record_ids=[])
    Then a ValueError is raised indicating record_ids must not be empty

  # ── Upload File to Existing Dataset ──────────────────────────────

  @integration
  Scenario: Upload a CSV file to an existing dataset
    Given a dataset "my-dataset" exists
    And a local CSV file "data.csv" with 3 rows
    When I call langwatch.dataset.upload("my-dataset", file_path="data.csv")
    Then the result indicates records were created from the CSV

  @integration
  Scenario: Upload a JSON file to an existing dataset
    Given a dataset "my-dataset" exists
    And a local JSON file "data.json" with 2 records
    When I call langwatch.dataset.upload("my-dataset", file_path="data.json")
    Then the result indicates records were created from the JSON

  @integration
  Scenario: Upload a JSONL file to an existing dataset
    Given a dataset "my-dataset" exists
    And a local JSONL file "data.jsonl" with 2 records
    When I call langwatch.dataset.upload("my-dataset", file_path="data.jsonl")
    Then the result indicates records were created from the JSONL

  @integration
  Scenario: Upload to a non-existent dataset raises an error
    Given a local CSV file "data.csv" with 1 row
    When I call langwatch.dataset.upload("ghost", file_path="data.csv")
    Then a DatasetNotFoundError is raised

  @unit
  Scenario: Upload validates that file exists
    When I call langwatch.dataset.upload("my-dataset", file_path="nonexistent.csv")
    Then a FileNotFoundError is raised

  @unit
  Scenario: Upload validates supported file extensions
    Given a local file "data.parquet" exists
    When I call langwatch.dataset.upload("my-dataset", file_path="data.parquet")
    Then a ValueError is raised indicating the file format is not supported

  # ── Create Dataset from File Upload ──────────────────────────────

  @integration
  Scenario: Create a dataset from a CSV file in one call
    Given a local CSV file "feedback.csv" with columns "question" and "answer" and 5 rows
    When I call langwatch.dataset.create_dataset_from_file(name="From CSV", file_path="feedback.csv")
    Then a DatasetInfo is returned with name "From CSV" and slug "from-csv"
    And the result indicates 5 records were created

  @integration
  Scenario: Create dataset from file with conflicting name raises an error
    Given a dataset named "Existing" already exists
    And a local CSV file "data.csv" with 1 row
    When I call langwatch.dataset.create_dataset_from_file(name="Existing", file_path="data.csv")
    Then a DatasetApiError is raised indicating a conflict

  # ── SDK Initialization ──────────────────────────────────────────

  @integration
  Scenario: SDK auto-initializes from environment variables
    Given LANGWATCH_API_KEY is set in the environment
    And the SDK has not been explicitly initialized
    When I call any dataset method
    Then the SDK initializes automatically using the environment API key
    And the method executes successfully

  @integration
  Scenario: SDK raises error when no API key is available
    Given LANGWATCH_API_KEY is not set in the environment
    And the SDK has not been explicitly initialized
    When I call any dataset method
    Then a RuntimeError is raised indicating the API key is missing

  # ── Return Types ────────────────────────────────────────────────

  @unit
  Scenario: Dataset object exposes entries as list of DatasetEntry
    Given a raw API response with 3 records
    When the response is converted to a Dataset object
    Then the Dataset has 3 DatasetEntry items
    And each DatasetEntry has id and entry attributes

  @unit
  Scenario: Dataset.to_pandas converts entries to a DataFrame
    Given a Dataset object with 2 entries having keys "input" and "output"
    When I call dataset.to_pandas()
    Then I receive a pandas DataFrame with 2 rows and columns "input" and "output"

  @unit
  Scenario: DatasetInfo object exposes dataset metadata without records
    Given a raw list/create/update API response
    When the response is converted to a DatasetInfo object
    Then it has id, name, slug, and columnTypes attributes
    And it does not contain record entries

  @unit
  Scenario: PaginatedResult exposes data list and pagination metadata
    Given a raw paginated API response with 3 items and total 10
    When the response is converted to a PaginatedResult
    Then .data contains 3 DatasetInfo items
    And .pagination.total is 10
    And .pagination.page, .limit, and .totalPages are present
