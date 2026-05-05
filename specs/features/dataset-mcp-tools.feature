Feature: Dataset MCP Tools
  As an AI agent using the MCP protocol
  I want to manage datasets through MCP tool calls
  So that I can create, browse, and modify datasets without using the UI or raw REST API

  Background:
    Given the MCP server is configured with a valid LangWatch API key

  # ── List Datasets ──────────────────────────────────────────────

  @integration
  Scenario: List datasets returns a formatted summary of all datasets
    Given the project has datasets "User Feedback" and "Training Data"
    When I call platform_list_datasets
    Then I receive a formatted list showing both datasets with their names, slugs, and record counts

  @integration
  Scenario: List datasets returns a helpful message when none exist
    Given the project has no datasets
    When I call platform_list_datasets
    Then I receive a message indicating no datasets were found
    And the message suggests using platform_create_dataset

  # ── Get Dataset ────────────────────────────────────────────────

  @integration
  Scenario: Get dataset by slug returns metadata and a preview of records
    Given a dataset "my-dataset" exists with 50 records and columns "input" and "output"
    When I call platform_get_dataset with slug "my-dataset"
    Then I receive the dataset name, slug, and column definitions
    And I receive a preview of the first records

  @unit
  Scenario: formatDatasetResponse renders column table and record entries as markdown
    Given a dataset response with columns and records
    When the formatting function processes the response
    Then the output includes a column table and record entries

  @integration
  Scenario: Get dataset with non-existent slug returns an error
    When I call platform_get_dataset with slug "does-not-exist"
    Then I receive an error indicating the dataset was not found

  # ── Create Dataset ─────────────────────────────────────────────

  @integration
  Scenario: Create a dataset with name and columns
    When I call platform_create_dataset with name "Test Data" and columns [{"name": "input", "type": "string"}, {"name": "output", "type": "string"}]
    Then the dataset is created successfully
    And I receive confirmation including the generated slug "test-data"

  @integration
  Scenario: Create a dataset with only a name and no columns
    When I call platform_create_dataset with name "Empty Schema"
    Then the dataset is created with an empty column list
    And I receive confirmation including the slug "empty-schema"

  @unit
  Scenario: platform_create_dataset schema rejects input without a name
    When the Zod schema validates input without a name
    Then the schema rejects the input with a validation error

  # ── Update Dataset ─────────────────────────────────────────────

  @integration
  Scenario: Update a dataset name
    Given a dataset with slug "old-name" exists
    When I call platform_update_dataset with slug "old-name" and new name "New Name"
    Then the dataset is updated
    And I receive confirmation reflecting the new name

  @integration
  Scenario: Update a dataset column types
    Given a dataset with slug "my-dataset" exists
    When I call platform_update_dataset with slug "my-dataset" and new columnTypes [{"name": "question", "type": "string"}]
    Then the dataset columns are updated
    And I receive confirmation reflecting the new columns

  @integration
  Scenario: Update a non-existent dataset returns an error
    When I call platform_update_dataset with slug "ghost" and new name "Whatever"
    Then I receive an error indicating the dataset was not found

  # ── Delete (Archive) Dataset ───────────────────────────────────

  @integration
  Scenario: Delete a dataset archives it
    Given a dataset with slug "to-delete" exists
    When I call platform_delete_dataset with slug "to-delete"
    Then the dataset is archived
    And I receive confirmation that the dataset was deleted

  @integration
  Scenario: Delete a non-existent dataset returns an error
    When I call platform_delete_dataset with slug "ghost"
    Then I receive an error indicating the dataset was not found

  # ── Create Records ─────────────────────────────────────────────

  @integration
  Scenario: Add records to a dataset
    Given a dataset "my-dataset" exists with columns "input" and "output"
    When I call platform_create_dataset_records with slug "my-dataset" and entries [{"input": "hello", "output": "world"}, {"input": "foo", "output": "bar"}]
    Then 2 records are added to the dataset
    And I receive confirmation with the count of records created

  @integration
  Scenario: Add records to a non-existent dataset returns an error
    When I call platform_create_dataset_records with slug "ghost" and entries [{"input": "hello"}]
    Then I receive an error indicating the dataset was not found

  # ── Update Record ──────────────────────────────────────────────

  @integration
  Scenario: Update a single record entry
    Given a dataset "my-dataset" has a record "rec-123" with entry {"input": "old"}
    When I call platform_update_dataset_record with slug "my-dataset", recordId "rec-123", and entry {"input": "updated"}
    Then the record is updated
    And I receive confirmation that the record was updated

  @integration
  Scenario: Update a record in a non-existent dataset returns an error
    When I call platform_update_dataset_record with slug "ghost", recordId "rec-1", and entry {"input": "x"}
    Then I receive an error indicating the dataset was not found

  # ── Delete Records ─────────────────────────────────────────────

  @integration
  Scenario: Delete records by IDs
    Given a dataset "my-dataset" has records "rec-1", "rec-2", "rec-3"
    When I call platform_delete_dataset_records with slug "my-dataset" and recordIds ["rec-1", "rec-2"]
    Then 2 records are deleted
    And I receive confirmation with the count of records deleted

  @integration
  Scenario: Delete records from a non-existent dataset returns an error
    When I call platform_delete_dataset_records with slug "ghost" and recordIds ["rec-1"]
    Then I receive an error indicating the dataset was not found

  # ── Tool Registration ──────────────────────────────────────────

  @unit
  Scenario: All dataset tools are registered in the MCP server
    When the MCP server is created
    Then the following tools are available:
      | tool name                          |
      | platform_list_datasets             |
      | platform_get_dataset               |
      | platform_create_dataset            |
      | platform_update_dataset            |
      | platform_delete_dataset            |
      | platform_create_dataset_records    |
      | platform_update_dataset_record     |
      | platform_delete_dataset_records    |

  @unit
  Scenario: Dataset tools require an API key
    Given the MCP server has no API key configured
    When I call any platform_*_dataset* tool
    Then the tool returns an error indicating an API key is required
