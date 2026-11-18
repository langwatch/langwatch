# Issue #9666. ADR-158 §4 and §7, amended for the per-account upload setting.
#
# Chart bindings: charts/langwatch/tests/stored-object-uploads-ingress.sh.
Feature: Uploads through LangWatch when browsers cannot reach the bucket
  As an operator whose object storage is only reachable inside the cluster
  I want uploads to go through LangWatch instead of straight to the bucket
  So that the UI and the SDKs can upload files without reaching the bucket themselves

  Rule: Each storage account says where clients send upload bytes

    @unit
    Scenario: An S3 account hands out a direct upload address by default
      Given the shared backend is S3 with no upload setting
      When a client creates an upload
      Then the upload address is a signed URL on the bucket's endpoint

    @unit
    Scenario: An S3 account set to upload through LangWatch hands out LangWatch's signed route
      Given the shared backend is S3 with uploads set to "through-langwatch"
      When a client creates an upload
      Then the upload address is LangWatch's signed upload route
      And no address on the bucket's endpoint is handed out

    @unit
    Scenario: An Azure account set to upload through LangWatch hands out LangWatch's signed route
      Given the shared backend is Azure Blob with uploads set to "through-langwatch"
      When a client creates an upload
      Then the upload address is LangWatch's signed upload route

    @unit
    Scenario: A per-organisation S3 account keeps its own upload setting
      Given the shared S3 account uploads directly
      And an organisation's own S3 account is set to upload through LangWatch
      When a project of that organisation creates an upload
      Then the upload address is LangWatch's signed upload route
      And a project of another organisation still gets a direct address

    @unit
    Scenario: An unknown upload setting is refused at boot by name
      Given the upload setting is "sideways"
      When the process boots
      Then boot is refused naming STORED_OBJECTS_UPLOADS and its allowed values

  Rule: An upload through LangWatch lands in the bucket once and confirms cheaply

    @integration
    Scenario: A file sent to LangWatch's signed route is stored in the bucket and confirms
      Given an account set to upload through LangWatch
      When a client creates an upload, sends the file to the address it was given and confirms
      Then the stored object is available with the file's length and SHA-256
      And confirming does not read the object back from the bucket

    @unit
    Scenario: A file that landed through LangWatch still confirms after the upload window
      Given a file was written through LangWatch's signed route before its upload expired
      When the client confirms after the 15-minute upload window
      Then the stored object becomes available

    @unit
    Scenario: A client that stops sending mid-upload gets an incomplete upload, not a platform fault
      Given a client sending a file to LangWatch's signed route
      When the client's connection breaks before the whole file arrived
      Then the upload is refused with code "upload_incomplete"
      And nothing is kept in the bucket

    @unit
    Scenario: Confirming while the file is still arriving is refused, and loses nothing
      Given a client is still sending a file to LangWatch's signed route
      When the client confirms before the file has fully arrived
      Then the confirm is refused with code "upload_incomplete"
      And once the file has arrived it confirms with its bytes intact

    @unit
    Scenario: A confirm and the reaper never both win
      Given an upload whose bytes landed and whose window has passed
      When a confirm and the reaper act on it at the same time, in either order
      Then the object ends either available with its bytes, or failed with its bytes deleted
      And the client is never told it is available when it is not

    @unit
    Scenario: The api allows a body up to two hours on the upload route only
      When the api's HTTP listener starts
      Then a request body sent to LangWatch's signed upload route may take up to two hours
      And a request body sent to any other route is cut after Node's five minutes
      And the worker's and the tasks' listeners keep Node's five minutes on every route
      And no idle-connection cut is added, so quiet event streams stay open

    @unit
    Scenario: A door in front of the api closes a client whose body the api cut
      Given a door in front of the api's listener: the liveness thread every booted process has, or the npx server's boot door
      When the api answers before the client's request body has fully arrived
      Then the door relays the answer and closes the client's connection
      And an answer the door writes itself, such as liveness or readiness, closes a connection whose body is still arriving
      And a request that declared no body keeps its connection for reuse

  Rule: Uploads nobody confirmed are cleaned up

    @unit
    Scenario: Expired pending uploads are reaped on a schedule
      Given a pending upload whose window expired an hour ago, with bytes in the bucket
      When the scheduled reaper wakes
      Then the bytes are deleted from the bucket
      And the record is marked failed
      And a pending upload still inside its window is left alone

  Rule: A misconfiguration is named before anyone uploads

    @unit
    Scenario: The storage checkup fails when uploads go through LangWatch but no public address is set
      Given an account set to upload through LangWatch
      And the deployment names no public base URL
      When the storage checkup runs
      Then it fails with code "direct_upload_unavailable"

    @unit
    Scenario: The storage checkup reads where uploads go from the account's setting
      Given an account set to upload through LangWatch, or one set to upload directly
      When the storage checkup runs
      Then it learns where the project's uploads go from that account's upload setting
      And an account set to upload through LangWatch signs no upload, so no signing key is fetched
      And an account set to upload directly signs one throwaway upload, proving it can sign one

  Rule: The chart routes uploads through an Ingress sized for files

    @unit
    Scenario: An nginx install routes LangWatch's upload route through its own Ingress
      Given the app Ingress is enabled with class "nginx"
      When the chart renders
      Then an Ingress routes /api/stored-objects/uploads (no trailing slash) on the app host to the app Service
      And it turns off request buffering, allows bodies up to the upload limit and sets long timeouts
      And the app Ingress keeps its own settings

    @unit
    Scenario: The chart passes the upload setting to the app and the workers
      Given app.dataplane.uploads is "through-langwatch"
      When the chart renders
      Then the app and worker containers get STORED_OBJECTS_UPLOADS=through-langwatch
      And without the value no STORED_OBJECTS_UPLOADS is set

  Rule: A failed direct upload names the host the browser could not reach

    @unit
    Scenario: The error names the bucket host and never the signed query
      Given a direct upload to "http://s3.managed.svc.cluster.local:9000" that the browser cannot reach
      When the upload fails
      Then the error names "s3.managed.svc.cluster.local:9000"
      And it does not contain the signed query
