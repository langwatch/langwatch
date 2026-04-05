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

  Scenario: Upload CSV to dataset
    When I run langwatch dataset upload my-dataset data.csv
    Then the CSV is uploaded and I see the record count

  Scenario: Upload JSONL to dataset
    When I run langwatch dataset upload my-dataset data.jsonl
    Then the JSONL is uploaded and I see the record count

  Scenario: Create and upload in one command
    When I run langwatch dataset upload --create "New Dataset" data.csv
    Then a dataset is created from the file and I see confirmation

  Scenario: Download dataset as CSV
    When I run langwatch dataset download my-dataset --format csv
    Then the dataset records are written to stdout as CSV

  Scenario: Download dataset as JSONL
    When I run langwatch dataset download my-dataset --format jsonl
    Then the dataset records are written to stdout as JSONL
