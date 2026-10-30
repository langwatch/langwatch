Feature: Datasets list page
  As a user with several datasets
  I want a clear overview of my datasets
  So that I can find, open, and manage them quickly

  Background:
    Given I am on the datasets page of my project

  # ============================================================================
  # Listing
  # ============================================================================

  @integration
  Scenario: Datasets are listed with their key facts
    Given my project has datasets
    Then I see one row per dataset
    And each row shows the dataset name, its columns, the number of entries, and when it was last updated

  @integration
  Scenario: Search datasets by name
    Given my project has datasets "offline evals" and "production samples"
    When I search for "offline"
    Then I see "offline evals"
    And I do not see "production samples"

  @integration
  Scenario: Open a dataset
    When I click a dataset row
    Then I land on that dataset's editor page

  @integration
  Scenario: Empty project shows a helpful empty state
    Given my project has no datasets
    Then I see an empty state explaining what datasets are for
    And I can create a dataset right from the empty state

  @integration
  Scenario: Empty-state CTA can launch the bulk upload flow
    Given my project has no datasets
    When I choose to upload datasets from the empty state
    Then I am taken into the upload flow to add files

  # ============================================================================
  # The list stays fast as the platform grows
  # ============================================================================
  #
  # Entry counts come from three places depending on where a dataset's content
  # lives: the records table for the original layout, a stored row count for
  # datasets kept as chunks in object storage (ADR-032), and a separate stored
  # count for the older single-file object-storage layout. Counting must never
  # depend on how much data other projects hold - a customer's list should load
  # at the same speed whether the platform serves one project or ten thousand.

  @integration
  Scenario: Listing never counts another project's entries
    Given another project holds far more dataset entries than mine
    When I open my datasets page
    Then the entry counts I see cover only my own project's datasets
    And no other project's entries are read to produce them

  @integration
  Scenario: Datasets kept in object storage report their count without reading entries
    Given every dataset in my project is stored in object storage
    When I open my datasets page
    Then each row shows the stored entry count
    And the entries table is not queried at all

  @integration
  Scenario: Entry counts are right whichever storage a dataset uses
    Given my project mixes datasets stored in the entries table with datasets stored in object storage
    When I open my datasets page
    Then every row shows that dataset's own entry count

  # Entry counts are a second read, asked once the list has arrived, so a slow
  # count never holds the list up.

  @integration
  Scenario: The list shows before entry counts arrive
    Given my datasets have loaded
    And their entry counts are still being counted
    When I open my datasets page
    Then I see one row per dataset
    And each row's entry count shows a loading skeleton

  @integration
  Scenario: A failed entry count read shows the counts as unavailable
    Given my datasets have loaded
    And reading their entry counts failed
    When I open my datasets page
    Then I see one row per dataset
    And each row's entry count shows as unavailable, not loading

  @integration
  Scenario: Entry counts arrive after the list
    Given my datasets are listed
    When their entry counts arrive
    Then each row shows that dataset's own entry count

  @unit
  Scenario: Datasets kept in object storage never have their entries counted
    Given my project mixes datasets stored in the entries table with datasets stored in object storage
    When their entry counts are asked for
    Then only the datasets stored in the entries table are counted, in one read
    And the others answer from their stored count

  @unit
  Scenario: An entry count refreshes after records are added
    Given a dataset's entries have been counted
    When I add records to it
    And its entry count is asked for again
    Then I see the new count

  @integration
  Scenario: The list loads while I wait, and tells me it is loading
    Given my datasets are still being fetched
    When I open my datasets page
    Then I see that the list is loading
    And I am not shown an empty-project message

  @integration
  Scenario: The datasets list shows no error when the read succeeded
    Given my datasets have loaded
    When nothing has failed
    Then I see my datasets
    And no "Couldn't load the datasets" notice is shown

  @integration
  Scenario: A failed refresh keeps the datasets I already see
    Given my datasets have loaded
    When a later refresh of the list fails
    Then I still see my datasets
    And I am told the refresh failed, above them

  # ============================================================================
  # Creating
  # ============================================================================

  @integration @unimplemented
  Scenario: Create a dataset from scratch
    When I choose to create a new dataset
    And I give it a name and columns
    Then the dataset appears in the list

  @integration @unimplemented
  Scenario: Create a dataset from a CSV file
    When I upload a CSV file
    Then a dataset is created with the file's columns and rows
    And it appears in the list

  # ============================================================================
  # Managing
  # ============================================================================

  @integration @unimplemented
  Scenario: Delete a dataset with undo
    When I delete a dataset from its row menu
    Then the dataset disappears from the list
    And I can undo the deletion from the confirmation message

  @integration @unimplemented
  Scenario: Replicate a dataset to another project
    When I choose "Replicate to another project" from a dataset's row menu
    Then I can pick a target project
    And the dataset is copied there

  @integration
  Scenario: Replicating a dataset offers only the projects I may create datasets in
    Given I may create datasets in one of my projects and not in another
    When I open the dataset replicate dialog
    Then only the project I may create datasets in is offered
