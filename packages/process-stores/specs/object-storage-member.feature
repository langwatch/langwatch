Feature: The object-storage member

  Object storage is a store the process supplies, like the other three
  (ADR-158, ARCHITECTURE.md §7). One member covers S3, Azure Blob and the
  local filesystem, routes per project, and has a memory twin. Every body is
  a stream and every digest is taken over a stream.

  @unit
  Scenario: An unplaceable project is refused rather than written to the shared bucket
    Given object storage with an organization on its own S3 account
    When a project whose organization the directory cannot name writes an object
    Then the write is refused with UnknownStorageProjectError

  @unit
  Scenario: A write counts and hashes a body larger than any buffer while it streams
    Given object storage on the local filesystem
    When a module writes a body of many megabytes, chunk by chunk
    Then the write answers its byte length and SHA-256
    And reading the object back streams the same bytes

  @unit
  Scenario: A body longer than its declared length is refused and leaves no file
    Given object storage on the local filesystem
    When a module writes a body one byte longer than it declared
    Then the write is refused with ObjectBodyTooLargeError
    And no object, temporary file or digest is left behind

  @unit
  Scenario: Confirm reads the digest the filesystem write kept
    Given an object written through the filesystem backend
    When its digest is asked for
    Then the digest the write computed is answered without streaming the object

  @unit
  Scenario: An S3 upload URL is signed over the content type and length
    Given object storage on S3
    When an upload URL is signed for a declared type and length
    Then the URL's signature covers content-type and content-length
    And it carries no checksum the client did not send

  @unit
  Scenario: An Azure upload URL is a SAS that may only create and write the one blob
    Given object storage on Azure Blob with an account key
    When an upload URL is signed
    Then it is a blob SAS with create and write permission and the BlockBlob header to send

  @unit
  Scenario: An S3 download URL is a presigned GET that lapses when asked
    Given an object stored on S3
    When a module asks for its download URL to lapse in fifteen minutes
    Then the answer is a presigned GET for that one key, valid for 900 seconds

  @unit
  Scenario: An Azure download URL is a SAS that may only read the one blob
    Given an object stored on Azure
    When a module asks for its download URL
    Then the answer is a blob SAS with read permission and nothing more

  @unit
  Scenario: Filesystem storage refuses to sign a download URL
    Given objects stored on the local filesystem
    When a module asks for a download URL
    Then it refuses, because no remote reader can reach a local directory

  @unit
  Scenario: The memory twin answers a deterministic download URL
    Given the memory object storage
    When a module asks for a download URL for one project's key
    Then the same address and expiry answer the same URL, naming the project and the key

  @unit
  Scenario: An incomplete Azure block is refused naming every missing variable
    Given STORED_OBJECTS_BACKEND=azure with no account name, container or key
    When the member is built
    Then it refuses with AzureBackendMisconfiguredError naming all three variables

  @unit
  Scenario: Memory stores answer object storage with its twin
    Given a process installed over memoryStores()
    When a module reading objectStorage writes, reads, digests and removes an object
    Then each operation answers as the live member would, without a datastore

  @unit
  Scenario: Object storage is addressed by project and key together
    Given the memory object storage
    When two projects write an object under the same key
    Then each project reads back its own object
    And removing one project's object leaves the other's in place

  @unit
  Scenario: A recorded location resolves to the project's own backend or the shared one
    Given object storage with an organization on its own S3 account beside a shared bucket
    When an object recorded on the organization's own bucket is read or signed for download
    And an object recorded on the shared bucket before the organization moved is read the same way
    Then each resolves to the bucket it was recorded on

  @unit
  Scenario: A recorded location outside the project's own and shared backends is refused
    Given object storage with two organizations on their own S3 accounts
    When a project names a recorded location on the other organization's bucket
    And a project names a bucket or filesystem root this deployment is not configured for
    Then read, digest, remove and download signing are refused with UnreachableStorageLocationError
    And nothing is read from that location

  @unit
  Scenario: An object key that leaves its root or container is refused
    Given object storage on the filesystem or on Azure Blob
    When a key holds an empty, "." or ".." segment
    Then the operation is refused before any file is opened or any request is signed

  @unit
  Scenario: An Azure key segment is encoded into the blob path
    Given object storage on Azure Blob
    When a key segment holds a space, "?", "#" or "%"
    Then the request and the signed URL name the blob with each segment percent-encoded
