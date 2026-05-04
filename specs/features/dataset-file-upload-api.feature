Feature: Dataset File Upload REST API
  As an API consumer (SDK, CLI, or AI agent)
  I want to upload CSV, JSON, and JSONL files to create or populate datasets via REST endpoints
  So that I can bulk-import data without manually constructing record payloads

  Background:
    Given a project with a valid API key in the X-Auth-Token header

  # ── Upload to Existing Dataset ─────────────────────────────────

  @integration
  Scenario: Upload a CSV file to an existing dataset
    Given a dataset "user-feedback" exists with columns [{"name": "input", "type": "string"}, {"name": "output", "type": "string"}]
    When I POST /api/dataset/user-feedback/upload with a CSV file containing:
      | input   | output          |
      | hello   | Hi there!       |
      | goodbye | See you later!  |
    Then the response status is 200
    And the dataset contains 2 new records with the uploaded values

  @integration
  Scenario: Upload a JSONL file to an existing dataset
    Given a dataset "logs" exists with columns [{"name": "message", "type": "string"}, {"name": "level", "type": "string"}]
    When I POST /api/dataset/logs/upload with a .jsonl file containing:
      """
      {"message": "started", "level": "info"}
      {"message": "crashed", "level": "error"}
      """
    Then the response status is 200
    And the dataset contains 2 new records

  @integration
  Scenario: Upload a JSON array file to an existing dataset
    Given a dataset "items" exists with columns [{"name": "name", "type": "string"}, {"name": "price", "type": "number"}]
    When I POST /api/dataset/items/upload with a .json file containing a JSON array of 3 objects
    Then the response status is 200
    And the dataset contains 3 new records

  @integration
  Scenario: Upload converts values to match column types
    Given a dataset "typed" exists with columns [{"name": "count", "type": "number"}, {"name": "active", "type": "boolean"}, {"name": "created", "type": "date"}]
    When I POST /api/dataset/typed/upload with a CSV file where all values are strings
    Then string values are coerced to numbers, booleans, and dates based on columnTypes

  @integration
  Scenario: Upload to dataset referenced by ID
    Given a dataset with id "dataset_abc123" exists
    When I POST /api/dataset/dataset_abc123/upload with a valid CSV file
    Then the response status is 200
    And records are added to the dataset

  @integration
  Scenario: Upload fails when file columns do not match dataset columns
    Given a dataset "strict" exists with columns [{"name": "input", "type": "string"}]
    When I POST /api/dataset/strict/upload with a CSV file containing columns "question" and "answer"
    Then the request fails with 400 Bad Request
    And the error indicates the uploaded columns do not match the dataset schema

  @integration
  Scenario: Upload to a non-existent dataset returns 404
    When I POST /api/dataset/does-not-exist/upload with a valid CSV file
    Then the request fails with 404 Not Found

  @integration
  Scenario: Upload without a file field returns 422
    Given a dataset "empty" exists
    When I POST /api/dataset/empty/upload with no file attached
    Then the request fails with 422 Unprocessable Entity

  @integration
  Scenario: Upload an empty file returns 422
    Given a dataset "empty" exists
    When I POST /api/dataset/empty/upload with a CSV file containing only headers and no data rows
    Then the request fails with 422 Unprocessable Entity
    And the error indicates the file contains no data rows

  @integration
  Scenario: Upload exceeding row limit is rejected
    Given a dataset "big" exists
    When I POST /api/dataset/big/upload with a CSV file containing 10,001 rows
    Then the request fails with 400 Bad Request
    And the error indicates the row limit of 10,000 has been exceeded

  @integration
  Scenario: Upload exceeding file size limit is rejected
    Given a dataset "big" exists
    When I POST /api/dataset/big/upload with a file larger than 25MB
    Then the request fails with 400 Bad Request
    And the error indicates the file size limit has been exceeded

  @integration
  Scenario: Upload with unsupported file format is rejected
    Given a dataset "any" exists
    When I POST /api/dataset/any/upload with a .xlsx file
    Then the request fails with 422 Unprocessable Entity
    And the error indicates the file format is not supported

  # ── Create + Upload in One Call ────────────────────────────────

  @integration
  Scenario: Create a new dataset from an uploaded CSV file
    When I POST /api/dataset/upload with name "From CSV" and a CSV file containing:
      | question       | answer     |
      | What is 2+2?   | 4          |
      | Capital of UK? | London     |
    Then a new dataset "From CSV" is created with slug "from-csv"
    And it has columns [{"name": "question", "type": "string"}, {"name": "answer", "type": "string"}]
    And the dataset contains 2 records
    And the response status is 201

  @integration
  Scenario: Create a new dataset from a JSONL file
    When I POST /api/dataset/upload with name "Logs" and a .jsonl file
    Then a new dataset "Logs" is created
    And column types are inferred from the JSONL keys, all defaulting to "string"

  @integration
  Scenario: Create + upload infers column types as string by default
    When I POST /api/dataset/upload with name "Inferred" and a CSV file with headers "age", "active", "notes"
    Then all three columns are created with type "string"

  @integration
  Scenario: Create + upload renames reserved column names
    When I POST /api/dataset/upload with name "Reserved" and a CSV file with columns "id", "input", "selected"
    Then the dataset is created with columns "id_", "input", "selected_"
    And the records use the renamed column names

  @integration
  Scenario: Create + upload requires a name field
    When I POST /api/dataset/upload with a CSV file but no name field
    Then the request fails with 422 Unprocessable Entity

  @integration
  Scenario: Create + upload requires a file field
    When I POST /api/dataset/upload with name "No File" but no file attached
    Then the request fails with 422 Unprocessable Entity

  @integration
  Scenario: Create + upload enforces dataset plan limits
    Given the project has reached its dataset plan limit
    When I POST /api/dataset/upload with name "Over Limit" and a valid CSV file
    Then the request fails with 403 Forbidden
    And the error indicates the dataset limit has been reached

  @integration
  Scenario: Create + upload fails when slug conflicts with existing dataset
    Given a dataset with slug "duplicate" already exists
    When I POST /api/dataset/upload with name "Duplicate" and a valid CSV file
    Then the request fails with 409 Conflict

  @integration
  Scenario: Create + upload rejects file exceeding row limit
    When I POST /api/dataset/upload with name "Too Big" and a CSV file containing 10,001 rows
    Then the request fails with 400 Bad Request
    And the error indicates the row limit of 10,000 has been exceeded

  # ── Format Detection ───────────────────────────────────────────

  @unit
  Scenario: Detect CSV format from .csv extension
    Given a file named "data.csv"
    When the format is detected from the file extension
    Then the detected format is "csv"

  @unit
  Scenario: Detect JSON format from .json extension
    Given a file named "data.json"
    When the format is detected from the file extension
    Then the detected format is "json"

  @unit
  Scenario: Detect JSONL format from .jsonl extension
    Given a file named "data.jsonl"
    When the format is detected from the file extension
    Then the detected format is "jsonl"

  @unit
  Scenario: Reject unknown file extension
    Given a file named "data.parquet"
    When the format is detected from the file extension
    Then it returns an unsupported format error

  # ── CSV Parsing ────────────────────────────────────────────────

  @unit
  Scenario: Parse CSV with first row as headers
    Given a CSV string with headers "a", "b" and 2 data rows
    When the CSV is parsed
    Then the result contains 2 records with keys "a" and "b"

  @unit
  Scenario: Parse CSV handles quoted values with commas
    Given a CSV string where a value contains a comma inside quotes
    When the CSV is parsed
    Then the quoted value is preserved as a single field

  # ── JSON/JSONL Parsing ─────────────────────────────────────────

  @unit
  Scenario: Parse JSONL with one object per line
    Given a JSONL string with 3 lines
    When the JSONL is parsed
    Then the result contains 3 records

  @unit
  Scenario: Parse JSONL ignores blank lines
    Given a JSONL string with blank lines between objects
    When the JSONL is parsed
    Then blank lines are skipped and only valid objects are returned

  @unit
  Scenario: Parse JSON array file
    Given a JSON string containing an array of 2 objects
    When the JSON is parsed
    Then the result contains 2 records

  @unit
  Scenario: Parse JSON falls back to JSONL when array parse fails
    Given a string that is not valid JSON but is valid JSONL
    When the JSON is parsed with JSONL fallback
    Then it successfully parses as JSONL

  # ── Reserved Column Renaming (server-side) ─────────────────────

  @unit
  Scenario: Rename "id" column to "id_"
    Given a list of column names including "id"
    When reserved columns are renamed
    Then "id" becomes "id_"

  @unit
  Scenario: Rename "selected" column to "selected_"
    Given a list of column names including "selected"
    When reserved columns are renamed
    Then "selected" becomes "selected_"

  @unit
  Scenario: Non-reserved columns are unchanged
    Given a list of column names "input", "output"
    When reserved columns are renamed
    Then both names remain unchanged

  # ── Authentication ─────────────────────────────────────────────

  @integration
  Scenario: Upload without API key returns 401
    When I POST /api/dataset/upload without X-Auth-Token header
    Then the request fails with 401 Unauthorized

  @integration
  Scenario: Upload to existing without API key returns 401
    When I POST /api/dataset/some-dataset/upload without X-Auth-Token header
    Then the request fails with 401 Unauthorized
