Feature: Create, edit and delete pattern
  As someone building a screen that manages a short list of records
  I want one runnable example of the list, the form, the confirmation and the Undo
  So that I copy a flow that already works, in light and dark

  @integration
  Scenario: Every dataset story shows its state in light and dark
    Given the named stories of the Create, edit and delete pattern
    When each is rendered in the light and in the dark colour mode
    Then it shows its own heading, form, message or notice

  @integration
  Scenario: A new dataset joins the list
    Given the dataset list
    When the reader creates a dataset from the form
    Then the list shows a row with the new name
    And the form closes

  @integration
  Scenario: Renaming changes the same row
    Given a dataset in the list
    When the reader renames it in the form
    Then the same row shows the new name and the old name is gone

  @integration
  Scenario: An invalid name is said under the field
    Given the create form with no name
    When the reader submits it
    Then the name field explains what is wrong and takes focus
    And nothing is added to the list

  @integration
  Scenario: A refused save keeps the draft and can be retried
    Given a save that is refused once
    When the reader submits the form
    Then the form says the save failed and keeps the name and columns
    And submitting again saves the dataset

  @integration
  Scenario: Cancelling a delete keeps the dataset
    Given the delete confirmation for a dataset
    When the reader cancels
    Then the dataset is still in the list

  @integration
  Scenario: Confirming a delete removes the row and moves focus
    Given the delete confirmation for a dataset
    When the reader confirms
    Then the row is gone and a notice names the dataset
    And focus moves to the neighbouring row

  @integration
  Scenario: Undo puts the dataset back where it was
    Given a deleted dataset and its notice
    When the reader chooses Undo
    Then the dataset returns to its place in the list

  @integration
  Scenario: A search with no match offers a way out
    Given the dataset list
    When the reader searches for a name nothing has
    Then the list says so, offers Clear filters and a prompt for a coding agent

  @unit
  Scenario: The example uses only public design system entry points
    Given the source of the example
    Then it imports no Chakra or Emotion and no design system file by relative path
