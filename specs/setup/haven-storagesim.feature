@unit
Feature: storagesim, a local S3 stand-in run by haven
  The product stores uploads by presigning a PUT, letting the browser send the
  bytes, and confirming the object exists before reading it back; its servers
  read, write and delete objects with the AWS SDK and hand out presigned GETs.
  storagesim answers exactly those S3 calls on a laptop, as S3 answers them:
  SigV4 checked against haven's dev key, S3's statuses and XML errors. Its
  storage is disposable and never holds anything executable.

  # Bound by Go tests in services/storagesim/storagesim_test.go and
  # tools/thuishaven/domain/overlay_storage_test.go, and by the console's
  # apps/storagesim-web tests (ADR-160), by their `// @scenario` annotations.

  Scenario: A presigned upload round-trips
    Given storagesim is running
    When a client PUTs bytes to a presigned URL for a key
    Then the PUT answers 200 with the bytes' MD5 as a quoted ETag
    And a HEAD on the key answers 200 with the length, content type and ETag
    And a GET on the key answers the same bytes

  Scenario: The product's S3 client reads, writes and deletes through storagesim
    Given storagesim holds the stack's bucket
    When the AWS SDK checks the bucket, puts an object, gets it and deletes it
    Then each call succeeds with the bytes and content type round-tripped
    And a get after the delete fails with NoSuchKey

  Scenario: A request without a valid signature is refused as S3 refuses it
    When a client calls storagesim with no signature
    Then it answers 403 with an S3 XML error whose code is AccessDenied
    And a tampered presigned signature or a wrong secret answers 403 SignatureDoesNotMatch
    And an access key other than haven's answers 403 InvalidAccessKeyId

  Scenario: An upload that differs from what was presigned is refused
    Given a PUT presigned for a content type and a byte length
    When the browser sends a different length or content type
    Then it answers 403 SignatureDoesNotMatch and stores nothing

  Scenario: A presigned URL past its expiry is refused
    Given a URL presigned with an expiry that has passed
    When a client uses it
    Then it answers 403 AccessDenied with the message "Request has expired"

  Scenario: A bucket storagesim does not hold answers NoSuchBucket
    Given storagesim is configured with the stack's bucket only
    When a client addresses another bucket
    Then it answers 404 with an S3 XML error whose code is NoSuchBucket

  Scenario: A key that reads as a path is refused
    When a client PUTs a key with a . or .. segment, a leading slash, a backslash or a NUL
    Then it answers 400 InvalidArgument
    And nothing is written outside the data directory

  Scenario: Stored objects are owner-only files that are never executable
    When a client uploads a shell script
    Then the data directory is 0700 and each stored file 0600 under a content-addressed name
    And a GET serves it nosniff, sandboxed and as an attachment

  # Implemented by tools/thuishaven/app/db.go (haven db reset); awaiting a bound thuishaven test.
  @unimplemented
  Scenario: A stack's objects are discarded with its databases
    Given a stack whose storagesim holds objects
    When the developer runs "haven db reset"
    Then the stack's storagesim data directory is removed with the databases

  Scenario: A client lists a bucket's keys with ListObjectsV2
    Given a bucket holding objects under several prefixes
    When a client sends GET /<bucket>?list-type=2, optionally with a prefix
    Then it answers ListBucketResult with each key, size, ETag and LastModified in lexical order
    And an unknown bucket answers 404 NoSuchBucket and a bad token or max-keys 400 InvalidArgument

  Scenario: A long listing is paged with a continuation token
    Given a bucket holding more keys than max-keys
    When a client lists it page by page
    Then each page is truncated with a NextContinuationToken until the last
    And following the tokens yields every key once, with a delimiter's common prefixes never repeated

  Scenario: A streamed SDK upload is stored without its chunk framing
    When the server's S3 client PUTs a body with aws-chunked framing
    Then a GET on the key answers the decoded bytes only

  Scenario: A missing key reads as S3 reads it
    When a client GETs a key that was never written
    Then it answers 404 with an S3 XML error whose code is NoSuchKey
    And a HEAD on that key answers a bare 404

  Scenario: A browser on the app origin may upload
    Given storagesim allows the stack's app origin
    When the browser sends a CORS preflight for a PUT from that origin
    Then it answers with that origin, the PUT method and the requested headers allowed
    And a preflight from any other origin is refused

  Scenario: haven runs storagesim by default and points the product at it
    Given a worktree that has never been up
    When the developer runs "haven up"
    Then a storage lane runs storagesim on a port haven allocated
    And the overlay sets STORED_OBJECTS_BACKEND, S3_BUCKET_NAME, S3_ENDPOINT and dummy S3 credentials for it
    And "haven up -storage" once turns it off for the worktree

  Scenario: A developer's own object storage choice wins
    Given the worktree's environment already names S3_BUCKET_NAME, S3_ENDPOINT, STORED_OBJECTS_BACKEND or LANGWATCH_LOCAL_STORAGE_PATH
    When the developer runs "haven up"
    Then the overlay sets none of the S3 variables

  Scenario: The console lists buckets and objects
    Given objects were uploaded to two buckets
    When the console reads /_sim/api/buckets and /_sim/api/objects?bucket=
    Then each bucket answers its object count and size
    And each object answers its key, size, content type, ETag and time

  Scenario: The console lists nothing for an empty store
    Given nothing has been uploaded
    When the console reads the buckets and objects
    Then both answer empty lists
    And the console shows an empty state instead of a table

  Scenario: The console shows one object and downloads its bytes
    Given an uploaded text object
    When the console opens the object
    Then it shows the object's headers and a text preview, and offers a download of the exact bytes
    And an unknown key answers a JSON error with status 404

  Scenario: The console remembers recent requests, newest first, up to a bound
    Given a PUT and a GET of a missing key were made
    When the console reads /_sim/api/requests
    Then it lists each request's method, key, status and time, newest first
    And it holds only the newest 500

  Scenario: The console deletes one object or clears a bucket
    Given objects in two buckets
    When the developer deletes one object, then clears one bucket, over the console API
    Then the deleted object reads as missing and only the other bucket's objects remain

  Scenario: The console mints a presigned URL that storagesim accepts
    Given an empty store
    When the console asks /_sim/api/presign for a PUT and then a GET of one key
    Then the presigned PUT stores the bytes and the presigned GET reads them back
    And a missing key, a method other than GET or PUT, or an expiry outside S3's bounds answers 400
    And the request log names each request's auth as presigned, with its request id

  Scenario: The console adds the demo objects on request
    Given an empty store
    When the developer POSTs /_sim/api/seed
    Then the demo objects are in bucket langwatch, and a GET of the route answers 405

  @integration
  Scenario: The console deletes, clears, seeds and presigns from its screens
    Given the console lists an object
    When the developer deletes it, clears its bucket, adds the demo objects and copies a presigned URL
    Then each action calls its control route and the lists refresh

  Scenario: haven storage presigns, seeds and reads the request log for agents
    When an agent runs "haven storage presign <bucket> <key> --put", "haven storage seed" and "haven storage requests"
    Then each calls its control route, and the requests verb prints auth and request id per line

  Scenario: The console serves its bundle beside the S3 paths
    When a browser opens /_sim/ on storagesim
    Then it serves the built console, or names the build command when the bundle is missing
