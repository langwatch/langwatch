Feature: Dataset CLI Commands
  As a developer using the LangWatch CLI
  I want to manage datasets from the terminal
  So that I can integrate dataset operations into my workflow

  Background:
    Given I am logged in with a valid API key

  Scenario: List datasets
    When I run langwatch dataset list
    Then I see a table of all datasets with name, slug, record count, and last updated

  Scenario: Create a dataset
    When I run langwatch dataset create "My Dataset" --columns input:string,output:string
    Then a new dataset is created and I see confirmation with the slug

  Scenario: Get dataset details
    When I run langwatch dataset get my-dataset
    Then I see dataset metadata and a preview of records

  Scenario: Delete a dataset
    When I run langwatch dataset delete my-dataset
    Then the dataset is archived and I see confirmation

  Scenario: Upload file to dataset with default append strategy
    When I run langwatch dataset upload my-dataset data.csv
    Then the file is uploaded and I see the record count

  Scenario: Upload with replace strategy
    When I run langwatch dataset upload my-dataset data.csv --if-exists replace
    Then existing records are deleted and the file is uploaded

  Scenario: Upload with error strategy
    When I run langwatch dataset upload my-dataset data.csv --if-exists error
    Then the command fails because the dataset already exists

  Scenario: Download dataset as CSV
    When I run langwatch dataset download my-dataset --format csv
    Then the dataset records are written to stdout as CSV

  Scenario: Download dataset as JSONL
    When I run langwatch dataset download my-dataset --format jsonl
    Then the dataset records are written to stdout as JSONL

  # ── Update Dataset ──────────────────────────────────────────────

  Scenario: Update a dataset name
    When I run langwatch dataset update my-dataset --name "New Name"
    Then the dataset is updated and I see the new name and slug

  Scenario: Update a dataset columns
    When I run langwatch dataset update my-dataset --columns question:string,answer:string
    Then the dataset is updated and I see the new column definitions

  Scenario: Update requires at least one option
    When I run langwatch dataset update my-dataset without --name or --columns
    Then I see an error that at least one option is required

  # ── Records List ────────────────────────────────────────────────

  Scenario: List records in a dataset
    When I run langwatch dataset records list my-dataset
    Then I see a table of records with column values and pagination info

  Scenario: List records with pagination
    When I run langwatch dataset records list my-dataset --page 2 --limit 10
    Then I see page 2 of records with 10 per page

  # ── Records Add ─────────────────────────────────────────────────

  Scenario: Add records with inline JSON
    When I run langwatch dataset records add my-dataset --json '[{"input":"hello"}]'
    Then the records are created and I see their IDs

  Scenario: Add records from stdin
    When I pipe JSON records to langwatch dataset records add my-dataset --stdin
    Then the records are created and I see their IDs

  @unit
  Scenario: Add records rejects non-array JSON
    When I provide a JSON object instead of an array
    Then the CLI reports that a JSON array is expected

  @unit
  Scenario: Add records rejects invalid JSON
    When I provide malformed JSON
    Then the CLI reports that the JSON could not be parsed

  # ── Records Update ──────────────────────────────────────────────

  Scenario: Update a single record
    When I run langwatch dataset records update my-dataset rec-1 --json '{"input":"updated"}'
    Then the record is updated and I see the record ID

  # ── Records Delete ──────────────────────────────────────────────

  Scenario: Delete records by IDs
    When I run langwatch dataset records delete my-dataset rec-1 rec-2
    Then the records are deleted and I see the count
