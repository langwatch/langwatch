Feature: Attach uploaded files to datasets
  As a user who builds a dataset
  I want to put a picture or a document into a cell, or build a dataset from a file
  So that my prompts and my agents can read the file itself, not a link they cannot open

  # Context: a file is uploaded once, for a purpose, straight to storage
  # (modules/stored-object/specs/purpose-scoped-upload.feature). A dataset never
  # receives the file's bytes: its create and update take the reference of an
  # uploaded and confirmed file, and check the purpose and the kind of file.
  # Decision record: dev/docs/adr/158-purpose-scoped-uploads.md.

  Background:
    Given I am logged in
    And I have access to a project

  # ============================================================================
  # The web-only direct-upload addresses (ADR-158 §8)
  # ============================================================================
  # Only the in-app upload drove them on main, so they are removed rather than
  # kept behind a refusal. Retry moves onto the application's own calls.

  @unit
  Scenario: The web-only direct-upload addresses are gone
    Given the dataset addresses the server declares
    Then none of them is a direct-upload address

  @unit
  Scenario: Retrying a failed import still works
    Given a dataset whose preparation from an uploaded file failed
    When I retry it
    Then the dataset is prepared again from the same stored file

  # ============================================================================
  # The multipart file upload addresses: kept for one release (ADR-158 §8)
  # ============================================================================
  # A time-boxed exception to "the server never takes file bytes": the Python SDK
  # still posts files to the upload pair, and main publishes the attachments
  # address. All three retire in the following release.

  @integration @unimplemented
  Scenario: Creating a dataset by posting a file still works and is marked deprecated
    Given I use a project API key that can create datasets
    When I post "customers.csv" to the dataset upload address
    Then the dataset is created with the file's rows
    And the answer says the address is deprecated and names upload-then-create as its successor

  @integration @unimplemented
  Scenario: Adding rows by posting a file to a dataset still works and is marked deprecated
    Given I use a project API key that can update datasets
    When I post "more-customers.csv" to the upload address of the dataset "Customers"
    Then I am told how many rows were added
    And the answer says the address is deprecated and names upload-then-create as its successor

  @unit
  Scenario: Posting a file to the dataset attachments address still works and is marked deprecated
    Given I use a project API key that can manage datasets
    When I post "receipt.png" to the dataset attachments address
    Then the file is stored as a dataset attachment of my project
    And I am answered the reference a cell holds, with the file's name, kind and size
    And the answer says the address is deprecated and names file upload as its successor

  @unit
  Scenario: The dataset attachments address refuses a file a browser can run
    When I post "page.html" to the dataset attachments address
    Then the upload is refused for its kind of file
    And nothing is stored

  @unit
  Scenario: The dataset attachments address refuses a file over the attachment limit
    When I post a file larger than 20 MB to the dataset attachments address
    Then the upload is refused as too large
    And nothing is stored

  @unit
  Scenario: A posted file over the old size limit is still refused
    When I post a file larger than 25 MB to the dataset upload address
    Then the upload is refused as too large

  # ============================================================================
  # Attaching a file to a cell
  # ============================================================================

  @integration @unimplemented
  Scenario: A cell takes the reference of a confirmed dataset attachment
    Given I have uploaded and confirmed "receipt.png" as a dataset attachment
    When I save a row whose image cell holds its reference
    Then the row is saved
    And the cell serves the picture back

  @integration @unimplemented
  Scenario: A dataset created with rows accepts attachment references
    Given I have uploaded and confirmed "contract.pdf" as a dataset attachment
    When I create a dataset whose first row's file cell holds its reference
    Then the dataset is created with that row

  @unit
  Scenario: A reference to a file that was never confirmed is refused
    Given I created an upload for "receipt.png" but did not confirm it
    When I save a row whose image cell holds its reference
    Then the row is refused
    And I am told which cell holds a file that is not available

  @unit
  Scenario: A reference to a file uploaded for another purpose is refused
    Given I have uploaded and confirmed "rows.csv" as a dataset import
    When I save a row whose file cell holds its reference
    Then the row is refused
    And I am told the file was not uploaded as a dataset attachment

  @unit
  Scenario: A reference to another project's file is refused
    Given a file confirmed as a dataset attachment in another project
    When I save a row in my project whose file cell holds its reference
    Then the row is refused
    And no file from the other project is attached

  @unit
  Scenario: An image cell refuses a file that is not a picture
    Given I have uploaded and confirmed "contract.pdf" as a dataset attachment
    When I save a row whose image cell holds its reference
    Then the row is refused
    And I am told the kinds of file an image cell accepts

  @unit
  Scenario: A file cell accepts any kind of file that can be uploaded
    Given I have uploaded and confirmed "contract.pdf" as a dataset attachment
    When I save a row whose file cell holds its reference
    Then the row is saved

  @unit
  Scenario: A reference the row already held is not checked again
    Given a row whose file cell holds a reference saved before this release
    When I change another cell of that row
    Then the row is saved
    And the existing reference is kept as it was

  @unit
  Scenario: Links and inline pictures still pass unchanged
    When I save a row whose image cell holds a link to another site or an inline picture
    Then the row is saved with the value as I wrote it

  @unit @unimplemented
  Scenario: The upload button and the save refuse on the same rules
    Given a file the dataset attachment rules refuse
    When I pick it for a cell
    Then I am told before any upload starts, with the same words the save would use

  # ============================================================================
  # Building a dataset from an uploaded file
  # ============================================================================

  @integration @unimplemented
  Scenario: Creating a dataset from an uploaded file prepares it in the background
    Given I have uploaded and confirmed "customers.csv" as a dataset import
    When I create a dataset named "Customers" from it
    Then the dataset appears as being prepared
    And its rows are read from the stored file and appear when preparation finishes

  @integration @unimplemented
  Scenario: The types I confirmed are applied when the dataset is built from the file
    Given I have uploaded and confirmed "customers.csv" as a dataset import
    When I create a dataset from it with the column "age" confirmed as a number
    Then the "age" column of the prepared dataset holds numbers

  @unit @unimplemented
  Scenario: A dataset cannot be built from a file uploaded for another purpose
    Given I have uploaded and confirmed "receipt.png" as a dataset attachment
    When I create a dataset from it
    Then the creation is refused
    And no dataset is created

  @unit @unimplemented
  Scenario: A dataset cannot be built from a file of a kind it cannot read
    Given I have uploaded and confirmed "notes.txt" as a dataset import
    When I create a dataset from it
    Then the creation is refused
    And I am told the kinds of file a dataset can be built from

  @integration @unimplemented
  Scenario: Retrying a failed preparation reads the same file again
    Given a dataset whose preparation from "customers.csv" failed
    When I retry it
    Then the dataset is prepared again from the same stored file
    And no second dataset is created

  @integration @unimplemented
  Scenario: A project API key can build a dataset from an uploaded file
    Given I use a project API key that can create datasets
    And I have uploaded and confirmed "customers.csv" as a dataset import through the public API
    When I create a dataset named "Customers" from it through the public API
    Then the dataset appears as being prepared

  @integration @unimplemented
  Scenario: Adding an uploaded file's rows to an existing dataset
    Given a dataset "Customers" and an uploaded and confirmed "more-customers.csv" as a dataset import
    When I add the file to "Customers"
    Then I am told how many rows were added

  # ============================================================================
  # Permissions
  # ============================================================================

  @unit
  Scenario: Reading a dataset attachment needs permission to view datasets
    Given a file that is stored as a dataset attachment
    When someone asks to read it
    Then permission to view datasets is required

  @integration @unimplemented
  Scenario: A caller without permission to update the dataset cannot attach a file
    Given my credentials can view datasets but not update them
    When I save a row whose image cell holds an uploaded file's reference
    Then the save is refused

  # ============================================================================
  # Reading a cell value back
  # ============================================================================

  @unit
  Scenario: A cell shows the name of the file it holds
    Given a cell that holds an uploaded file named "quarter report.pdf"
    Then the cell shows the name "quarter report.pdf"
    And a cell that holds a link to another site shows the last part of that link
