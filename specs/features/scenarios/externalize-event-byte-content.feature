Feature: Externalize event byte content to stored_objects
  As a platform operator and SDK consumer
  I want byte content (audio, images, PDFs) in scenario events stored out-of-band
  So that event payloads stay small, the ClickHouse event store stays lean, and the SDK wire format never changes

  Background:
    Given a project with scenarios configured
    And the stored_objects table exists in ClickHouse
    And both S3 and local filesystem storage drivers are registered

  # ---------------------------------------------------------------
  # Schema (AC1)
  # ---------------------------------------------------------------

  @integration
  Scenario: Stored objects metadata table exists with the documented shape
    Given a fresh ClickHouse instance
    When the migrations are applied
    Then a table "stored_objects" exists with columns id, project_id, purpose, owner_kind, owner_id, media_type, size_bytes, sha256, storage_uri, created_at, inserted_at
    And the engine is ReplacingMergeTree on inserted_at
    And the table is ordered by (project_id, id)
    And the table is partitioned by toYYYYMM(created_at)
    And bloom-filter skip indexes exist on sha256 and on purpose

  @unimplemented
  @integration
  Scenario: Stored objects migration is idempotent
    Given the stored_objects migration has already been applied
    When the migration runs a second time
    Then the migration completes without error
    And the table schema is unchanged

  # ---------------------------------------------------------------
  # Storage drivers (AC2, AC3, AC4, AC5, AC6)
  # ---------------------------------------------------------------

  @unit
  Scenario: StorageDriver interface exposes get, put, delete, exists
    Given the StorageDriver interface
    Then it declares an async get returning a readable stream
    And it declares an async put accepting uri, bytes, and media type
    And it declares an async delete
    And it declares an async exists returning a boolean

  @integration
  Scenario: S3 driver handles s3 URIs through the configured S3 client
    Given an S3 driver bound to the project S3 config
    When the caller puts bytes at an s3 URI
    Then the bytes are written to the resolved bucket and key
    And a subsequent get returns the same bytes
    And exists returns true for the URI

  @integration
  Scenario: Local filesystem driver writes under the configured root using atomic rename
    Given a local filesystem driver with root LANGWATCH_LOCAL_STORAGE_PATH
    When the caller puts bytes at a file URI
    Then a temporary file is written first
    And the temporary file is renamed to the final path atomically
    And a subsequent get returns the same bytes

  @unit
  Scenario: Storage registry dispatches by URI scheme
    Given a registry with both drivers registered
    When a caller passes an s3 URI to get
    Then the S3 driver handles the request
    When a caller passes a file URI to get
    Then the local filesystem driver handles the request

  @integration
  Scenario: Both drivers remain available for reads regardless of which scheme new URIs use
    Given a deployment that previously minted file URIs
    And the deployment now mints s3 URIs for new content
    When the application reads an existing file URI
    Then the local filesystem driver streams the bytes back

  @unit
  Scenario: Minted URI is content-addressed under projectId and sha256
    Given a project id and a sha256
    When the URI is minted for s3 backend
    Then the URI matches s3://<bucket>/<projectId>/<sha256>
    When the URI is minted for the local filesystem backend
    Then the URI matches file:///<root>/<projectId>/<sha256>

  @unit
  Scenario: Same content from the same project yields the same URI
    Given two PUTs of identical bytes within the same project
    When the URI is computed for each
    Then both URIs are identical
    And the second PUT is idempotent at the storage layer

  # ---------------------------------------------------------------
  # Event ingest (AC7, AC8, AC9)
  # ---------------------------------------------------------------

  @integration
  Scenario: Inline file part is externalized and the event payload is rewritten by id
    Given a scenario event whose message content includes a file part with base64 data
    When the event is POSTed to /api/scenario-events
    Then the bytes are decoded and a sha256 is computed
    And a stored_objects row is inserted with the new id and media type
    And the event payload is rewritten so the file part carries id and mediaType instead of data
    And the stored bytes can be retrieved via GET /api/files/:id

  @integration
  Scenario: Duplicate content within a project reuses the existing stored_objects id
    Given a project that has already stored a file with sha256 S
    When a new event arrives carrying inline bytes with the same sha256 S
    Then no new stored_objects row is written
    And the event payload references the existing id
    And the storage backend is not asked to PUT again

  @integration
  Scenario: Stored object id is deterministic so concurrent ingest of the same content collapses cleanly
    Given two pods receive the same event payload concurrently
    When both extract the inline bytes
    Then both compute the same stored_objects id from (project_id, sha256)
    And ReplacingMergeTree collapses the duplicate inserts to a single row
    And every event that references the id remains resolvable

  @integration
  Scenario: Storage put failure aborts the entire event with a 5xx and no partial state
    Given the storage driver will reject the next PUT with a 5xx error
    When an event with inline file content is POSTed
    Then the API responds with a 5xx
    And no stored_objects row is written
    And no event lands in the ClickHouse event store

  @unimplemented
  @integration
  Scenario: Event POST rejects bodies larger than 50MB with 413 before extraction
    Given a request body exceeding 50MB on /api/scenario-events
    When the request reaches the handler
    Then the API responds with 413
    And no extraction logic runs
    And no stored_objects row is written

  # ---------------------------------------------------------------
  # Read path (AC10, AC11, AC12)
  # ---------------------------------------------------------------

  @integration
  Scenario: GET /api/files/:id streams the bytes for an existing row
    Given a stored_objects row with id F exists for the caller's project
    And the backing storage contains the bytes
    When the caller GETs /api/files/F
    Then the response is 200
    And the Content-Type matches the stored media type
    And the Content-Length matches size_bytes
    And the response body is the original bytes

  @integration
  Scenario: GET /api/files/:id returns 404 with status missing when storage no longer holds the blob
    Given a stored_objects row with id F exists for the caller's project
    But the storage backend returns 404 for the row's URI
    When the caller GETs /api/files/F
    Then the response is 404
    And the response body is {"status":"missing"}

  @integration
  Scenario: GET /api/files/:id returns 502 with a friendly message on transient storage failure
    Given a stored_objects row with id F exists for the caller's project
    But the storage backend returns a 5xx error
    When the caller GETs /api/files/F
    Then the response is 502
    And the response body says "file temporarily unavailable"

  @integration
  Scenario: GET /api/files/:id enforces project ownership through the shared permission check
    Given a stored_objects row with id F exists for project A
    And the caller is authenticated for project B
    When the caller GETs /api/files/F
    Then the response is forbidden
    And no bytes are streamed

  @unimplemented
  @integration
  Scenario: GET /api/files/:id honors the standard per-project rate limit
    Given the caller has reached the per-project rate limit
    When the caller GETs /api/files/:id
    Then the response is 429

  # ---------------------------------------------------------------
  # UI render path (AC13, AC14)
  # ---------------------------------------------------------------

  @integration
  Scenario: Trace timeline renders the new file id shape as an inline media tag
    Given a trace timeline message carries a file part with id F and mediaType audio/mpeg
    When the timeline renders
    Then an audio element is rendered with src "/api/files/F"

  @integration
  Scenario: Trace timeline still renders legacy inline base64 file shapes unchanged
    Given a historical trace message carries a file part with inline base64 data
    When the timeline renders
    Then the file is rendered from the inline data without calling /api/files

  @integration
  Scenario: Trace timeline shows a missing badge when the byte content is no longer retrievable
    Given a trace message references id F
    And GET /api/files/F returns {"status":"missing"}
    When the timeline renders
    Then a placeholder block is shown labeled with the file's mediaType
    And the placeholder displays a "missing" badge

  # ---------------------------------------------------------------
  # Lifecycle / cascade (AC15, AC16)
  # ---------------------------------------------------------------

  @integration
  Scenario: Stored objects rows are tenant-tagged so a future project-purge can cascade
    Given a stored_objects row is written during event ingest
    Then the row carries the project_id of the ingesting project
    And the row's storage URI is namespaced under the same project_id

  @integration
  Scenario: No automatic retention, time-based GC, or orphan reaping runs
    Given a stored_objects row that has not been referenced for any length of time
    When the system runs its scheduled jobs
    Then no job deletes the row or its underlying bytes

  # ---------------------------------------------------------------
  # Code structure (AC17)
  # ---------------------------------------------------------------

  @unit
  Scenario: StoredObjectsService exposes storeFromBytes, getById, cascadeDeleteProject, cascadeDeleteOwner
    Given the StoredObjectsService class
    Then it exposes storeFromBytes
    And it exposes getById
    And it exposes cascadeDeleteProject
    And it exposes cascadeDeleteOwner
    And it depends on StoredObjectsRepository and the storage registry as interfaces

  @unimplemented
  @unit
  Scenario: Route handlers delegate to the service and never touch the repository directly
    Given the /api/scenario-events handler and the /api/files/:id handler
    When their imports are inspected
    Then neither imports the repository directly
    And both go through StoredObjectsService

  # ---------------------------------------------------------------
  # Observability (AC18, AC19, AC20)
  # ---------------------------------------------------------------

  @unimplemented
  @integration
  Scenario: OpenTelemetry spans wrap extraction during ingest and reads via /api/files/:id
    Given OpenTelemetry tracing is enabled
    When an event with inline file content is ingested
    Then a span named for stored-object extraction is recorded
    When the file is fetched via GET /api/files/:id
    Then a span for the file read is recorded

  @integration
  Scenario: Prometheus metrics emit for ingest, dedup, write and read failures, and size distribution
    Given the metrics endpoint is scraped
    When events with file parts are ingested and files are fetched
    Then the counter stored_object_extract_total{purpose} increases
    And the counter stored_object_dedup_hit_total{purpose} increases on dedup hits
    And the counter stored_object_write_failures_total{purpose} increases on storage write failure
    And the counter stored_object_read_failures_total increases on storage read failure
    And the histogram stored_object_size_bytes{purpose} observes the byte size

  @unimplemented
  @integration
  Scenario: Ingest logs list every stored_objects id extracted for an event
    Given an event with two inline file parts is ingested
    When the ingest log line for that event is inspected
    Then the log line lists both stored_objects ids that were created or reused

  # ---------------------------------------------------------------
  # Tests (AC21, AC22)
  # ---------------------------------------------------------------

  @integration
  Scenario: Integration suite covers every documented ingest and read shape
    Given the integration test suite for stored_objects
    Then it covers ingest with a file part
    And it covers a dedup hit within the same project
    And it covers a dedup miss across projects
    And it covers storage PUT failure producing a 5xx and no event
    And it covers GET on an existing row
    And it covers GET on a row whose storage is missing
    And it covers GET on a row that does not exist
    And it covers 413 on a body greater than 50MB
    And it covers the project-delete cascade contract for tenant-tagged rows

  @integration
  Scenario: Local filesystem driver write is atomic under interruption
    Given a local filesystem driver writing bytes to a final path
    When the write is interrupted before rename completes
    Then no torn file is observable at the final path
    And a subsequent retry of the same content produces a complete file at the final path

  # --- AC Coverage Map ---
  # AC1  "stored_objects table with documented schema"                       -> Scenario: Stored objects metadata table exists with the documented shape
  #                                                                          -> Scenario: Stored objects migration is idempotent
  # AC2  "StorageDriver interface defined"                                   -> Scenario: StorageDriver interface exposes get, put, delete, exists
  # AC3  "S3Driver implementation handles s3:// URIs"                        -> Scenario: S3 driver handles s3 URIs through the configured S3 client
  # AC4  "LocalFilesystemDriver atomic PUT via tmp + rename"                 -> Scenario: Local filesystem driver writes under the configured root using atomic rename
  #                                                                          -> Scenario: Local filesystem driver write is atomic under interruption
  # AC5  "Registry dispatches by URI scheme; both drivers always registered" -> Scenario: Storage registry dispatches by URI scheme
  #                                                                          -> Scenario: Both drivers remain available for reads regardless of which scheme new URIs use
  # AC6  "Content-addressed URI layout; same sha256 + project = same URI"    -> Scenario: Minted URI is content-addressed under projectId and sha256
  #                                                                          -> Scenario: Same content from the same project yields the same URI
  # AC7  "Ingest decodes, sha256, dedup probe, mint/reuse id, rewrite part"  -> Scenario: Inline file part is externalized and the event payload is rewritten by id
  #                                                                          -> Scenario: Duplicate content within a project reuses the existing stored_objects id
  #                                                                          -> Scenario: Stored object id is deterministic so concurrent ingest of the same content collapses cleanly
  # AC8  "5xx on storage put failure; no partial state"                      -> Scenario: Storage put failure aborts the entire event with a 5xx and no partial state
  # AC9  "50MB body limit; 413 before extraction"                            -> Scenario: Event POST rejects bodies larger than 50MB with 413 before extraction
  # AC10 "GET /api/files/:id read path with 200/404/502 contract"            -> Scenario: GET /api/files/:id streams the bytes for an existing row
  #                                                                          -> Scenario: GET /api/files/:id returns 404 with status missing when storage no longer holds the blob
  #                                                                          -> Scenario: GET /api/files/:id returns 502 with a friendly message on transient storage failure
  # AC11 "Auth enforces project ownership via the shared permission check"   -> Scenario: GET /api/files/:id enforces project ownership through the shared permission check
  # AC12 "Per-project rate limit on the read endpoint"                       -> Scenario: GET /api/files/:id honors the standard per-project rate limit
  # AC13 "UI renders new id shape; old inline shape still renders"           -> Scenario: Trace timeline renders the new file id shape as an inline media tag
  #                                                                          -> Scenario: Trace timeline still renders legacy inline base64 file shapes unchanged
  # AC14 "Missing badge placeholder when GET returns status missing"         -> Scenario: Trace timeline shows a missing badge when the byte content is no longer retrievable
  # AC15 "Rows carry project_id; future purge handler cascades"              -> Scenario: Stored objects rows are tenant-tagged so a future project-purge can cascade
  # AC16 "No automatic retention, GC, or orphan reaping"                     -> Scenario: No automatic retention, time-based GC, or orphan reaping runs
  # AC17 "Layered route -> service -> (repo | storage) with Zod data"       -> Scenario: StoredObjectsService exposes storeFromBytes, getById, cascadeDeleteProject, cascadeDeleteOwner
  #                                                                          -> Scenario: Route handlers delegate to the service and never touch the repository directly
  # AC18 "OpenTelemetry spans on ingest extraction and on file reads"        -> Scenario: OpenTelemetry spans wrap extraction during ingest and reads via /api/files/:id
  # AC19 "Counter/histogram metrics for extract, dedup, failures, size"      -> Scenario: Prometheus metrics emit for ingest, dedup, write and read failures, and size distribution
  # AC20 "Event-ingest logs list per-event stored_objects.id values"         -> Scenario: Ingest logs list every stored_objects id extracted for an event
  # AC21 "Integration suite covers full ingest/read/cascade contract"        -> Scenario: Integration suite covers every documented ingest and read shape
  # AC22 "Local FS driver atomic PUT regression"                             -> Scenario: Local filesystem driver write is atomic under interruption
