Feature: Dataset upload dropzone states

  The "Upload CSV" drawer presents a single dropzone whose look reflects where
  the user is in the flow: an inviting empty state, a clear highlight while a
  file is dragged over it, and — once a file is chosen — a status row that
  shows the file's name, size and what is happening to it (selected, uploading,
  ready, or rejected). One CSV makes one dataset; the dropzone never accepts a
  batch.

  Background:
    Given I am on the datasets page
    And I open the "Upload CSV" drawer

  @unit
  Scenario: The empty dropzone invites a file
    When no file has been chosen yet
    Then the dropzone shows an upload illustration
    And it reads "Drag and drop file, or click to browse"
    And it lists the supported file types

  @unit
  Scenario: Dragging a file over the dropzone highlights it
    When I drag a file over the dropzone
    Then the dropzone is highlighted as an active drop target
    And the highlight clears when the file leaves the dropzone

  @unit
  Scenario: A chosen file appears as a status row
    When I choose a CSV file
    Then the dropzone shows a row with the file name and its size
    And the row offers a way to remove the file

  @unit
  Scenario: Removing the chosen file returns the empty dropzone
    Given I have chosen a CSV file
    When I remove it from the row
    Then the dropzone returns to its empty, inviting state

  @unit
  Scenario: A file that breaks a limit is rejected on its row
    Given object storage is unavailable on this install
    When I choose a file larger than the in-browser limit
    Then the file's row is marked as an error
    And the row explains the file is too large
    And the upload is not started

  @unit
  Scenario: An uploading file shows progress and can be cancelled
    When the file is uploading
    Then its row shows it is uploading
    And the row offers to cancel

  @unit
  Scenario: A finished upload shows a ready row without leaving the drawer
    When my uploaded dataset finishes preparing
    Then its row shows it is ready
    And I stay in the drawer until I choose to view the dataset
