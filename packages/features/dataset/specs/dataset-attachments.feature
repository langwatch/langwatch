Feature: Files uploaded into a dataset cell
  A person editing a dataset can put a picture or a document straight into a
  cell instead of hunting for a public URL. The bytes are kept with the
  project's other stored objects and the cell keeps a reference to them, so
  the same file can be read back by anyone who may read the dataset.

  @unit
  Scenario: An uploaded file is kept and the cell gets a reference to it
    Given a project whose deployment keeps stored objects
    When a person uploads a picture into a dataset cell
    Then the bytes are kept under the dataset attachment purpose
    And the answer carries the reference the cell stores, the file name, the media type and the size

  @unit
  Scenario: A file larger than the attachment limit is refused
    When a person uploads a file whose bytes exceed the attachment limit
    Then the request fails with dataset_attachment_too_large
    And nothing is kept

  @unit
  Scenario: A file the browser could not read is refused
    When a person uploads a body that is not a base64 data URL
    Then the request fails with dataset_attachment_unreadable
    And nothing is kept

  @unit
  Scenario: A deployment that keeps no stored objects refuses the upload by name
    Given a deployment that composed no object storage
    When a person uploads a file into a dataset cell
    Then the request fails with dataset_attachment_storage_unavailable

  @unit
  Scenario: The media type is taken from the file name when the browser does not say
    When a person uploads a PDF that the browser sent as a generic binary
    Then the file is kept as a PDF

  @unit
  Scenario: A file name that carries a path is reduced to the name alone
    When a person uploads a file whose name carries directory separators
    Then only the last part of the name is kept
    And the kept name is no longer than the name limit

  @unit
  Scenario: The upload is allowed to a person who may edit the dataset
    Given the dataset record surface
    When the process mounts it
    Then the attachment upload declares the dataset update permission

  @unit
  Scenario: Reading an attachment asks for the dataset view permission
    Given a stored object kept under the dataset attachment purpose
    When the file route decides which permission guards the read
    Then it asks for datasets:view

  @integration
  Scenario: A reader who may only see traces cannot read a dataset attachment
    Given a caller whose key reaches traces but not datasets
    When they read a stored object kept under the dataset attachment purpose
    Then the read is refused

  @integration
  Scenario: A reader who may see datasets reads the attachment
    Given a caller who holds the dataset view permission and no other file permission
    When they read a stored object kept under the dataset attachment purpose
    Then the bytes are returned

  @integration
  Scenario: A read whose address names another project is refused
    Given a caller authenticated for one project
    When they read a file address that names a different project
    Then the read is refused before any bytes are read
