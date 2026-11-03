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
