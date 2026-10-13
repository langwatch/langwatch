Feature: A dataset's slug is stable once minted
  As an SDK or API caller addressing a dataset by its slug
  I want renaming the dataset in the UI to leave the slug alone
  So that my code keeps finding the dataset

  The slug is minted from the name when the dataset is created and never
  follows a later rename. A new name whose slug another dataset holds is still
  refused. REST coverage lives in specs/features/dataset-rest-api.feature.

  Background:
    Given I am signed in to a project with datasets

  @integration
  Scenario: The edit drawer shows the slug the dataset keeps
    Given a dataset named "Original" with the slug "original"
    When I type the new name "Renamed Dataset" in its edit drawer
    Then the slug shown is still "original"
    And no warning says the slug will change

  @integration
  Scenario: The edit drawer still flags a name another dataset's slug holds
    Given datasets "Alpha" and "Beta" with slugs "alpha" and "beta"
    When I type the new name "Beta" in the edit drawer of "Alpha"
    Then the name is flagged as conflicting with "Beta"

  @integration
  Scenario: Saving a rename from the UI keeps the slug
    Given a dataset named "Original" with the slug "original"
    When I save it with the name "Renamed Dataset"
    Then its slug is still "original"

  @integration
  Scenario: Undoing an archive restores the slug the dataset kept
    Given a dataset with the slug "kept-slug" was renamed to "Something Else"
    When I archive it and then undo the archive
    Then its slug is "kept-slug" again
