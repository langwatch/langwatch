Feature: Image and file cells in the dataset grid
  As a user who builds a dataset
  I want to put a picture or a document into a cell
  So that I can test prompts and agents with real files

  # The same grid renders in the dataset editor and in the evaluations
  # workbench, so both surfaces get the same cell.
  #
  # A cell value stays a plain string. An uploaded file becomes a LangWatch
  # address, and an address that a user types stays as it is.

  Background:
    Given I have a dataset with an image column and a file column
    And I open the dataset in the grid

  # ============================================================================
  # Empty cells
  # ============================================================================

  @integration
  Scenario: An empty image cell offers upload or a URL
    When I look at an empty image cell
    Then I see an Upload button
    And I see a link to enter a URL

  @integration
  Scenario: An empty file cell offers upload or a URL
    When I look at an empty file cell
    Then I see an Upload button
    And I see a link to enter a URL

  @integration
  Scenario: The URL link opens the cell editor
    Given I look at an empty image cell
    When I click the link to enter a URL
    Then the cell editor opens
    And I can type an address into it

  # ============================================================================
  # Upload
  # ============================================================================

  @integration
  Scenario: Uploading a picture fills the image cell
    Given I look at an empty image cell
    When I choose a picture from my computer
    Then the cell holds the address of the stored picture
    And the cell shows a preview of the picture

  @integration
  Scenario: Uploading a document fills the file cell
    Given I look at an empty file cell
    When I choose a document from my computer
    Then the cell holds the address of the stored document
    And the cell shows the name of the document

  @integration
  Scenario: A refused upload states the reason and keeps the cell editable
    Given I look at an empty file cell
    When I choose a file that the server refuses
    Then the cell states why the file was refused
    And the Upload button stays available

  @integration
  Scenario: An oversize file is refused before the upload starts
    Given I look at an empty file cell
    When I choose a file larger than the size limit
    Then the cell states that the file is too large
    And no upload request is sent

  # ============================================================================
  # Filled cells
  # ============================================================================

  @integration
  Scenario: An image address still shows a preview
    When I look at an image cell that holds an image address
    Then the cell shows a preview of the picture

  @integration
  Scenario: A filled cell can be replaced
    Given I look at an image cell that holds an image address
    When I replace the picture with a different one
    Then the cell holds the address of the new picture

  @integration
  Scenario: A filled cell can be cleared
    Given I look at an image cell that holds an image address
    When I clear the cell
    Then the cell is empty again

  @integration
  Scenario: A file cell with an address on another site shows a name
    When I look at a file cell that holds an address on another site
    Then the cell shows the last part of the address as the name
    And an address with no path shows the host of the site

  @integration
  Scenario: A file chip opens the file in a new tab
    Given I look at a file cell that holds a stored document
    When I click the name of the document
    Then the file opens in a new tab
