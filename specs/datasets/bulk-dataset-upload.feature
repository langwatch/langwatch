Feature: Bulk dataset upload

  Uploading datasets one at a time is slow when you have several. The "Bulk
  upload" drawer lets you drop multiple files at once and turns each into its
  own dataset, prepared in the background. Every file appears as its own row so
  you can see — and fix — each one independently: the columns detected from the
  file are shown collapsed with sensible defaults, and you only expand a row if
  you want to rename a column or change its type before uploading. One file
  failing never blocks the others, and you can retry just that one.

  This is a separate surface from the single-file "Upload CSV" flow, which is
  unchanged. The same file types are accepted as the single-file flow (CSV,
  JSON, JSONL). Each row moves through its own states: ready-to-upload →
  queued → preparing → ready, or → failed (with retry).

  Background:
    Given I am on the datasets page
    And I open the "Bulk upload" drawer

  # ── Adding files ────────────────────────────────────────────────────

  @integration
  Scenario: Dropping several files lists one row per file
    When I drop three supported files onto the drawer
    Then I see three rows, one per file
    And each row shows the file's name and size
    And the upload action is enabled

  @integration
  Scenario: Adding more files appends to the list
    Given I have already added two files
    When I add two more
    Then the list shows four rows
    And no earlier row is replaced

  @integration
  Scenario: The same file dropped twice becomes two rows
    Given I have added a file
    When I add the very same file again
    Then there are two rows for it
    And each row is tracked independently

  @integration @unimplemented
  Scenario: A file of an unsupported type is rejected on its own row
    When I add a supported file and an unsupported file together
    Then the unsupported file's row shows it was not accepted
    And the supported file's row is still ready to upload
    And the upload action uploads only the accepted file

  @integration @unimplemented
  Scenario: A file too large to upload is rejected on its own row
    When I add a file larger than the maximum upload size
    Then that file's row shows it is too large
    And it is not uploaded
    And it never counts against my dataset allowance

  @integration
  Scenario: Removing a not-yet-started file drops only that row
    Given I have added three files
    When I remove one of them
    Then only that row is gone
    And the other two remain ready to upload

  @integration
  Scenario: Removing the last file disables the upload action
    Given I have added one file
    When I remove it
    Then the drawer returns to its empty, inviting state
    And the upload action is disabled

  # ── Confirming columns inline ───────────────────────────────────────

  @integration
  Scenario: Each file's columns are detected and shown collapsed
    When I add a file
    Then its detected columns are shown collapsed
    And every column defaults to text
    And I can expand the row to rename a column or change its type
    And I cannot add or remove columns for that file

  @integration
  Scenario: Columns can be dragged to reorder before uploading
    Given I have added a file and expanded its columns
    Then every column has a drag handle
    And I can drag a column to a new position
    And the dataset is created with the columns in the order I chose
    And each column's values stay correct despite the new order

  @integration
  Scenario: Confirming columns never opens a separate drawer
    When I add a file and expand its columns
    Then I edit the column names and types in place on that row
    And no extra drawer or dialog opens

  @integration @unimplemented
  Scenario: A file whose columns cannot be detected still uploads
    Given I have added a file whose header cannot be read
    When I start the upload
    Then that file is still uploaded
    And its columns are determined while it is prepared

  # ── Uploading independently ─────────────────────────────────────────

  @integration
  Scenario: Uploading prepares every file independently in the background
    Given I have added three files
    When I start the upload
    Then all three are accepted without me waiting on each one in turn
    And each row reports its own progress
    And each becomes ready on its own

  @unit
  Scenario: A large batch starts a few files and queues the rest
    Given I have added more files than prepare at once
    When I start the upload
    Then some files begin preparing immediately
    And the remaining files are shown as queued, not stuck
    And a queued file starts as soon as an earlier one finishes

  @integration @unimplemented
  Scenario: The drawer summarises overall batch progress
    Given I have started an upload of several files
    Then I see how many are ready, preparing, queued, and failed
    And the summary updates as each file changes state

  @integration
  Scenario: The types I confirmed are applied to that file's dataset
    Given I have added a file and changed one column to a number
    When I start the upload and it finishes preparing
    Then that dataset reports the column as a number
    And the other files are unaffected by my change

  @integration
  Scenario: Files that share a name become distinct datasets
    Given I have added several files that all share the same name
    When I start the upload
    Then each becomes its own dataset with a distinct name
    And none overwrites another

  # ── Quota ───────────────────────────────────────────────────────────

  @integration
  Scenario: A batch larger than my remaining dataset allowance
    Given my project has room for fewer datasets than I have added
    When I start the upload
    Then the files that fit my allowance become ready
    And the files beyond it fail with a clear "limit reached" message
    And only the datasets actually created count against my allowance

  # ── Per-file failure and recovery ───────────────────────────────────

  @integration
  Scenario: One file failing does not stop the others
    Given I have added three files and one of them cannot be prepared
    When I start the upload
    Then the two good files still become ready
    And the failed file shows an error with the option to retry

  @integration @unimplemented
  Scenario: An empty file fails on its own row instead of hanging
    Given I have added an empty file alongside a good one
    When I start the upload
    Then the empty file's row shows it failed, not a stuck spinner
    And the good file still becomes ready

  @integration
  Scenario: Retrying a failed file re-runs only that file and creates no duplicate
    Given I have started an upload and one file has failed
    When I retry that file
    Then only that file is re-run
    And it does not create a second dataset for the same file
    And the files that already succeeded are not touched

  @integration @unimplemented
  Scenario: Cancelling one in-flight file leaves the others alone
    Given I have started an upload of three files
    When I cancel one file while it is still uploading
    Then that file stops and leaves nothing half-created behind
    And the other two continue preparing

  @integration @unimplemented
  Scenario: Closing the drawer mid-upload keeps the files preparing
    Given I have started an upload of several files
    When I close the drawer before they finish
    Then the files keep preparing in the background
    And I follow their progress in my datasets list as they become ready

  # ── Storage-agnostic + large files ──────────────────────────────────

  @unit
  Scenario: Large files do not freeze the app while uploading
    Given I have added a very large file
    When I start the upload
    Then the app stays responsive
    And the file is sent without being read into the browser first

  @integration @unimplemented
  Scenario: Bulk upload works on a self-hosted install without object storage
    Given a self-hosted install without object storage
    When I bulk upload several files
    Then each file is still accepted and prepared
    And each dataset becomes ready

  # ── Accessibility ───────────────────────────────────────────────────

  @integration
  Scenario: The bulk upload flow is operable by keyboard and screen reader
    When I add files using the keyboard
    Then I can add, expand, and remove a file without a mouse
    And each row's status change is announced to assistive technology
    And the expand control and the remove and retry actions are labelled
