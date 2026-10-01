Feature: Upload a file for a purpose
  As someone putting a file into LangWatch
  I want to send the file to a signed address, for a stated purpose, the same way wherever it is stored
  So that large files upload quickly and each feature only uses the files meant for it

  # Decision record: dev/docs/adr/158-purpose-scoped-uploads.md. The client never learns which
  # storage backend is in use and never hashes the file. The server takes upload bytes only at
  # the local signed address, which streams them to disk unparsed. The digest is computed on
  # confirm, over a stream. Every stored file's id is a new KSUID; its purpose is on its record.

  Background:
    Given I am logged in
    And I have access to a project

  # ============================================================================
  # Creating an upload
  # ============================================================================

  @integration @unimplemented
  Scenario: Creating an upload for a purpose answers a signed address to put the file to
    When I ask to upload "receipt.png" of 2 KB as a dataset attachment
    Then I get back an address to put the file to, with any headers to send and when it stops working
    And I get back the id of the new file
    And the new file's record says it is a dataset attachment

  @integration @unimplemented
  Scenario Outline: Every storage backend answers the same kind of upload address
    Given my installation stores files in <storage>
    When I ask to upload "receipt.png" as a dataset attachment
    Then I get back a signed address to put the file to
    And putting the file there and confirming works the same way as anywhere else

    Examples:
      | storage               |
      | S3                    |
      | Azure Blob Storage    |
      | the local file system |

  @unit
  Scenario: Every stored file gets a new id of its own
    Given I have uploaded and confirmed "receipt.png" as a dataset attachment
    When I upload and confirm the same file again
    Then the second file has a new id
    And neither id is derived from the file's contents, its project or its purpose

  @unit
  Scenario: A purpose that only LangWatch itself writes cannot be uploaded
    When I ask to upload a file as trace content
    Then the upload is refused as a purpose that cannot be uploaded

  @unit
  Scenario: A file over the purpose's size limit is refused before any transfer
    When I ask to upload a 30 MB file as a dataset attachment
    Then the upload is refused as too large
    And I am told the largest size a dataset attachment can be

  @unit
  Scenario: A dataset import may be far larger than an attachment
    When I ask to upload a 2 GB CSV file as a dataset import
    Then I get back an address to put the file to

  @unit
  Scenario: A file a browser can run is refused for every purpose
    When I ask to upload a web page, a scalable vector image or a script for any purpose
    Then the upload is refused
    And I am told which kinds of file are not accepted

  @integration @unimplemented
  Scenario: Uploading needs permission to update the project
    Given my role can view the project but not update it
    When I ask to upload a file for any purpose
    Then the upload is refused for lack of permission
    And no upload is started

  @integration @unimplemented
  Scenario: A project API key can upload through the public API
    Given I use a project API key that can update the project
    When I create an upload, put the file to its address and confirm it
    Then I get back a reference to the stored file

  @integration @unimplemented
  Scenario: An upload burst past the ceiling is rate limited
    Given I have started as many uploads in this minute as the ceiling allows
    When I start one more
    Then it is refused as rate limited
    And I am told how long to wait

  # ============================================================================
  # Putting the bytes
  # ============================================================================

  @integration @unimplemented
  Scenario: On local storage the file streams straight to disk
    Given my installation keeps files on the local disk
    When I put the file to the signed address I was given
    Then the file is written to disk as it arrives, without being held in memory
    And its digest is computed as it streams
    And its contents are never interpreted

  @integration
  Scenario: A local upload with a missing, altered or expired signature is refused before the body is read
    Given my installation keeps files on the local disk
    When I put a file to the upload address with a missing, altered or expired signature
    Then the upload is refused
    And the body is never read
    And nothing is written to disk

  @integration
  Scenario: A local upload longer than declared is cut off and discarded
    Given I asked to upload a file of 2 KB
    When I put more than 2 KB to the signed address
    Then the upload is refused as too large
    And no partial file is left behind

  @integration @unimplemented
  Scenario: An S3 upload address only accepts the declared size and media type
    Given my installation stores files in S3
    When I ask to upload a file of 2 KB as "image/png"
    Then the signed address refuses a body of another size or media type

  # ============================================================================
  # Confirming: the digest is computed here
  # ============================================================================

  @integration @unimplemented
  Scenario: Confirming a finished upload makes the file available
    Given I have put the whole file to the signed address
    When I confirm the upload
    Then I get back a reference with the file's name, media type and size
    And the file's record holds its digest and the purpose I named

  @integration @unimplemented
  Scenario: Confirming on storage that holds no digest reads the file back as a stream
    Given my installation stores files in Azure Blob Storage
    And I have put the whole file to the signed address
    When I confirm the upload
    Then the stored file is read back through the digest as a stream, never held whole in memory
    And the digest is recorded on the file's record

  @integration @unimplemented
  Scenario: Confirming a file of a different size than declared is refused
    Given I asked to upload a file of 2 KB
    And a file of another size was put to the signed address
    When I confirm the upload
    Then the confirmation is refused as a size mismatch
    And the file does not become available

  @integration @unimplemented
  Scenario: Confirming before the file has arrived is refused
    Given I have created an upload but put nothing to its address
    When I confirm the upload
    Then the confirmation is refused as incomplete

  @unit
  Scenario: Confirming twice answers the same reference
    Given I have confirmed an upload
    When I confirm it again
    Then I get back the same reference

  @integration @unimplemented
  Scenario: An upload never confirmed expires and is cleaned up
    Given I created an upload and never confirmed it
    When its time runs out
    Then the upload can no longer be confirmed
    And whatever was put is removed

  # ============================================================================
  # Files LangWatch stores itself
  # ============================================================================

  @unit
  Scenario: A file LangWatch stores itself gets a new id and is hashed as it streams
    When LangWatch stores the same picture from two traces
    Then each is stored as its own file with its own new id
    And each digest is computed as the bytes stream to storage, never over the whole file in memory

  # ============================================================================
  # Reading back: one index
  # ============================================================================

  @integration @unimplemented
  Scenario: A confirmed upload is readable at its file address
    Given I have confirmed "receipt.png" as a dataset attachment
    When I open its file address
    Then the picture is served with its own media type, streamed from storage
    And the browser is told the file name "receipt.png"

  @integration @unimplemented
  Scenario: A file stored before the move to the new index is still readable
    Given a file was stored before this release and has not been moved to the new index yet
    When I open its file address
    Then the file is served as before, under its existing id

  @integration @unimplemented
  Scenario: Reading a stored file needs the permission its purpose names
    Given a trace file, a scenario file and a dataset attachment stored in a project
    When someone who can view datasets but not traces or scenarios asks to read each
    Then the dataset attachment is served
    And the trace file and the scenario file are refused
