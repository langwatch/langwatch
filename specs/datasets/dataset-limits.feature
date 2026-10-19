Feature: Dataset limits sized for image datasets
  As someone evaluating on large image datasets
  I want every dataset limit to fit rows that hold several images
  So that a dataset of thousands of images uploads, reads and runs

  Every dataset size limit is derived from the largest file an image or file
  cell accepts (20 MB unless raised for the organization) and from a row
  holding up to ten such files.

  @unit
  Scenario: Every dataset size limit follows the per-file limit
    Given the largest file a dataset cell accepts is 20 MB
    Then one row of an uploaded file may hold ten such files inline
    And one upload call may hold four such rows
    And one logged results batch may hold one such row
    And a read that holds a whole dataset in memory may hold one such row

  @unit
  Scenario: Raising the per-file limit raises every limit derived from it
    Given an organization whose largest accepted file was raised to 40 MB
    Then no derived dataset limit is lower than its default
    And a response carrying rows inline fits one row holding one 40 MB file

  @unit
  Scenario: Uploads accept one hundred thousand rows and six hundred attachment uploads a minute
    Then one dataset upload may hold 100,000 rows
    And one caller may upload 600 attachments a minute

  # ============================================================================
  # Each organization answers its own limits
  # ============================================================================

  @unit
  Scenario: A project answers the limits of its own organization
    Given an organization whose largest accepted file was raised to 40 MB
    And another organization on the default limits
    When each asks for its dataset limits
    Then the raised organization is told 40 MB per file and the limits derived from it
    And the other organization is told 20 MB per file

  @unit
  Scenario: An organization with a raised per-file limit attaches a file above 20 MB
    Given an organization whose largest accepted file was raised to 40 MB
    When I ask to upload a 30 MB picture for a dataset cell
    Then I am given an upload address that accepts the picture

  @unit
  Scenario: An organization on the default limit is refused the same file before any byte is sent
    Given an organization on the default limits
    When I ask to upload a 30 MB picture for a dataset cell
    Then I am refused as too large, told the limit is 20 MB
    And no upload address is given

  @integration
  Scenario: A cell takes a file above 20 MB when my organization's limit was raised
    Given my organization's largest accepted file was raised to 40 MB
    When I choose a 21 MB file for an empty file cell
    Then the file is uploaded and the cell holds it

  # ============================================================================
  # Uploading a file of rows
  # ============================================================================

  @unit
  Scenario: An uploaded file with a row of several megabytes is accepted
    When I upload a file whose row holds 9 MB
    Then the row is stored whole

  @unit
  Scenario: An uploaded row larger than the row limit is refused naming the limit
    When I upload a file whose row is larger than my organization's row limit
    Then the upload is refused as a row too large, told the limit
    And the file is not read to its end

  @unit
  Scenario: An uploaded file larger than the file limit is refused naming the limit
    When I upload a file larger than my organization's upload limit
    Then the upload is refused as too large, told the limit
    And no row is stored

  @unit
  Scenario: An uploaded file with more rows than the row count limit is refused naming the limit
    When I upload a file with more rows than my organization's row count limit
    Then the upload is refused, told how many rows one upload may hold
    And no row is stored

  @unit
  Scenario: A .json array larger than its limit is refused and names JSONL
    When I upload a .json file larger than my organization's limit for a .json array
    Then the upload is refused as too large
    And I am told to convert it to JSONL

  @unit
  Scenario: An import of a stored file larger than the upload limit is refused before it is read
    Given a confirmed import file larger than my organization's upload limit
    When I create a dataset from it, or add its rows to a dataset
    Then I am refused as too large, told the limit
    And the file is not read

  @unit
  Scenario: A file posted to the deprecated upload address stops at one full row
    When I post a file larger than one full row to the deprecated upload address
    Then I am refused as too large
    And I am told to upload it as a stored object and import it

  @unit
  Scenario: An uploaded file with inline pictures stores each picture and keeps its reference
    When I upload a file whose rows hold pictures written inline as base64
    Then each picture is stored as a dataset attachment
    And each cell holds the reference to its stored picture
    And the column is typed as an image

  @unit
  Scenario: A row too large to store after its pictures are stored is refused
    When I save a row that is still larger than 16 MB once its pictures are stored
    Then the row is refused as too large to store
    And nothing is written

  # ============================================================================
  # Reading a dataset
  # ============================================================================

  @unit
  Scenario: Reading a whole dataset too large for one response is refused and names paging
    Given a dataset larger than one response carries
    When I read the whole dataset in one call
    Then I am refused, told to read it page by page
    And no partial list of rows is answered

  @unit
  Scenario: A read that stops early reports how many rows it loaded
    Given a dataset larger than one response carries
    When the dataset editor loads its rows
    Then the answer says it stopped early
    And it says how many rows it loaded and how many the dataset holds

  @unit
  Scenario: A read that stops early reports the same on a dataset stored in chunks
    Given a dataset stored in chunks that is larger than one response carries
    When the dataset editor loads its rows
    Then the answer says it stopped early
    And it says how many rows it loaded and how many the dataset holds

  @unit
  Scenario: A download reads every row of a dataset within the whole-read limits
    Given a dataset larger than one response carries but within the whole-read limits
    When I download the dataset
    Then every row is answered

  @unit
  Scenario: A download of a dataset larger than the whole-read limits is refused, never cut
    Given a dataset that holds more rows or bytes than my organization's whole-read limits
    When I download the dataset
    Then I am refused, told to read it page by page
    And no partial list of rows is answered

  @unit
  Scenario: A copy carries every row of the dataset
    Given a dataset of several hundred rows
    When I copy it to another project
    Then the copy holds every row

  @unit
  Scenario: A page of rows too large for one response names a page size that fits
    Given a dataset whose rows hold large files inline
    When I ask for a page of rows larger than one response carries
    Then I am refused, told a smaller page size and the page to ask for next
    And following it reaches every row

  @unit
  Scenario: A page holding a single row is always answered
    Given a dataset with one row larger than one response carries
    When I ask for a page of one row
    Then the row is answered

  @unit
  Scenario: A page of rows carries the dataset it belongs to
    When I ask for a page of a dataset's rows
    Then the answer carries the dataset's name, columns and address beside the rows

  # ============================================================================
  # Rate
  # ============================================================================

  @unit
  Scenario: Asking for an upload address is held to the same rate as attachment uploads
    Then one caller may ask for 600 upload addresses a minute
