Feature: Workbench dataset column edits
  As an author editing a dataset's columns in the experiments workbench
  I want each column's values to follow the column through the edit
  So that renaming, adding, removing or reordering columns never loses data

  @unit
  Scenario: Renaming an inline dataset column keeps its values
    Given an inline dataset with a column "test" holding "hello" in its first row
    When I edit the columns and rename "test" to "test2"
    Then the first row of "test2" holds "hello"
    And an added column starts empty
    And a removed column's values are gone while the others keep theirs
    And reordered columns keep their own values

  @unit
  Scenario: Renaming a saved dataset column keeps its values in the workbench
    Given a saved dataset whose records are loaded in the workbench
    When I edit the columns and rename one
    Then the loaded records show their values under the new name

  @unit
  Scenario: A pending saved-dataset cell edit follows a column rename
    Given a cell edit on a saved dataset that has not synced yet
    When the columns drawer renames that cell's column before the sync runs
    Then the queued edit is saved under the new column name
    And a queued value for a column the same save deleted is dropped

  @unit
  Scenario: Columns drawer edits carry mappings to renamed columns and clear those to deleted ones
    Given a runner and an evaluator whose inputs read dataset columns
    When one save in the columns drawer renames a column and deletes another
    Then the inputs that read the renamed column read its new name
    And the inputs that read the deleted column are cleared
    And swapping two columns' names swaps the inputs that read them
