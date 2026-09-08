Feature: Attach files to dataset cells
  As a user who builds a dataset
  I want to put a picture or a document into a cell
  So that my prompts and my agents can read the file itself, not a link they cannot open

  # Context: image and file cells accept a URL today, so a user who has the file
  # on disk has to publish it somewhere first. The upload surface takes the file
  # into the project's own object store and gives the cell a reference that the
  # product can read back. The file is served from our own origin, so a file
  # that a browser can execute is refused at upload time.

  Background:
    Given I am logged in
    And I have access to a project

  # ============================================================================
  # Upload
  # ============================================================================

  @integration
  Scenario: Uploading a file into a project stores it once and returns a reference
    Given I have a picture on my computer
    When I upload it to my project
    Then I get back a reference to the stored file
    And the reference reports the size of the file
    When I upload the same picture again
    Then I get back the same reference
    And the file is kept only once

  @integration
  Scenario: The reference carries the file name and serves the file with its media type
    Given I have uploaded a picture named "receipt.png" to my project
    When I open the reference
    Then the picture is served with its own media type
    And the browser is told the file name "receipt.png"

  @unit
  Scenario: A file over the size limit is refused with a clear error
    Given I have a file that is larger than the upload limit
    When I upload it to my project
    Then the upload is refused
    And I am told the largest size I can upload

  @integration
  Scenario: A media type that can run in the browser is refused
    Given I have a file that a browser can run, such as a web page, a scalable vector image or a script
    When I upload it to my project
    Then the upload is refused
    And I am told which kinds of file are not accepted

  # ============================================================================
  # Permissions
  # ============================================================================

  @unit
  Scenario: Reading a dataset attachment needs permission to view datasets
    Given a file that is stored as a dataset attachment
    When someone asks to read it
    Then permission to view datasets is required

  @integration
  Scenario: A caller without permission to manage datasets cannot upload
    Given my credentials cannot manage datasets
    When I upload a file to my project
    Then the upload is refused
    And no file is stored

  @integration
  Scenario: An API key caller can upload
    Given I use a project API key that can manage datasets
    When I upload a file to my project
    Then I get back a reference to the stored file

  # ============================================================================
  # Reading a cell value back
  # ============================================================================

  @unit
  Scenario: A cell shows the name of the file it holds
    Given a cell that holds an uploaded file named "quarter report.pdf"
    Then the cell shows the name "quarter report.pdf"
    And a cell that holds a link to another site shows the last part of that link
