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

  @unit
  Scenario: Route handlers delegate to the service and never touch the repository directly
    Given the /api/scenario-events handler and the /api/files/:id handler
    When their imports are inspected
    Then neither imports the repository directly
    And both go through StoredObjectsService

  # ---------------------------------------------------------------
  # Observability (AC18, AC19, AC20)
  # ---------------------------------------------------------------

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

  # ---------------------------------------------------------------
  # Ingest — additional shapes and failure modes (AC23, AC24, AC25, AC26)
  # ---------------------------------------------------------------

  @integration
  Scenario: Extractor handles MESSAGE_SNAPSHOT events with messages[] in addition to TEXT_MESSAGE_END events with single message
    Given a MESSAGE_SNAPSHOT event whose messages array contains a message with inline file parts
    When the event is processed by the extractor
    Then every inline file part in every message is externalized
    And the messages array is rewritten with id references
    And the event payload remains a valid MESSAGE_SNAPSHOT shape

  @integration
  Scenario: Content parts that fail AG-UI parse cause the message to pass through unchanged
    Given a message whose content array contains a part with an unrecognized type
    When the extractor walks the part list
    Then no part is rewritten
    And no stored_objects row is inserted
    And the original message object reference is preserved so callers can detect no-op

  @integration
  Scenario: Binary part variant with inline data is externalized to id and url
    Given a message content part of type binary carrying base64 data and a mimeType
    When the extractor processes the part
    Then a stored_objects row is created
    And the rewritten part carries id and url fields
    And the rewritten part no longer carries the data field

  @unit
  Scenario: Binary part variant rejects parts that carry data plus an explicit id or url
    Given a binary part with both data and id set
    Then the AG-UI schema rejects it as invalid
    Given a binary part with both data and url set
    Then the AG-UI schema rejects it as invalid

  @integration
  Scenario: DB insert failure after a successful storage PUT triggers compensating storage delete
    Given the storage driver accepts the PUT
    But the stored_objects row insert fails
    When the service surfaces the error
    Then a compensating delete is invoked on the storage URI
    And when that delete succeeds no orphaned bytes remain at the storage URI
    And when that delete itself fails the service still surfaces the original DB error without throwing the delete error

  @integration
  Scenario: ClickHouse insert errors surface synchronously to the caller
    Given the stored_objects repository inserts a row
    When the ClickHouse insert returns an error
    Then the service rejects with the underlying error
    And the storage object has not been left in place

  # ---------------------------------------------------------------
  # Read path — auth modes and not_found vs missing (AC27, AC28, AC29)
  # ---------------------------------------------------------------

  @integration
  Scenario: GET /api/files/:id authenticates a browser via session cookie when no API key header is present
    Given a stored_objects row with id F exists for project A
    And the caller has an active session cookie for a user with scenarios:view on project A
    When the caller GETs /api/files/F with the cookie and no API key header
    Then the response is 200
    And the bytes stream back unchanged

  @integration
  Scenario: GET /api/files/:id authenticates via API key header when no session cookie is present
    Given a stored_objects row with id F exists for project A
    And the caller presents an API key scoped to project A
    When the caller GETs /api/files/F with the API key header
    Then the response is 200
    And the bytes stream back unchanged

  @integration
  Scenario: GET /api/files/:id returns 404 with status not_found when no row exists for the id
    Given no stored_objects row exists for id F in any project
    When any authenticated caller GETs /api/files/F
    Then the response is 404
    And the response body is {"status":"not_found"}
    And the project membership check is never run

  @integration
  Scenario: GET /api/files/:id resolves the owning project from the row id before applying the membership check
    Given a stored_objects row with id F exists for project A
    And the caller has an active session for a user in project B but not project A
    When the caller GETs /api/files/F
    Then the response is 403
    And the bytes are not streamed
    And the row's project_id is not leaked in the error body

  # ---------------------------------------------------------------
  # Storage URI / BYOC (AC30, AC31)
  # ---------------------------------------------------------------

  @integration
  Scenario: For a project with a per-project private dataplane bucket, mintStorageUri uses the project bucket, not the global one
    Given project A is configured with private dataplane bucket "dataplane-acme"
    And the global S3_BUCKET_NAME is "langwatch-storage-prod"
    When the service mints a storage URI for project A
    Then the URI starts with "s3://dataplane-acme/"
    And the URI does not reference "langwatch-storage-prod"
    And a subsequent GET reads back from "dataplane-acme"

  @integration
  Scenario: For a project without per-project storage configured, mintStorageUri falls back to the global S3_BUCKET_NAME
    Given project B has no private dataplane bucket configured
    And the global S3_BUCKET_NAME is set
    When the service mints a storage URI for project B
    Then the URI uses the global bucket
    And the stored row's storage_uri matches the URL the read path uses

  @unit
  Scenario: storage_uri persisted on the stored_objects row is the authoritative bucket address for reads
    Given a stored_objects row was written with storage_uri "s3://bucket-X/proj/sha"
    When the read path resolves the URI
    Then the S3 client is asked to read from bucket-X
    And the read does not fall back to the global S3_BUCKET_NAME

  # ---------------------------------------------------------------
  # Helm + self-hosting deployment (AC32, AC33, AC34, AC35)
  # ---------------------------------------------------------------

  @unit
  Scenario: Helm chart emits S3_BUCKET_NAME (not legacy S3_BUCKET) so the app and stored-objects find the bucket
    Given the chart is rendered with app.dataplaneObjectStorage.bucket set
    When the deployment manifest is inspected
    Then the app container env contains S3_BUCKET_NAME
    And the app container env does NOT contain a legacy S3_BUCKET key

  @unit
  Scenario: Helm chart exposes a single dataplane object-storage config block covering datasets and stored-objects together
    Given app.dataplaneObjectStorage.enabled is true in values.yaml
    When the chart renders the app and workers deployments
    Then both pods receive the same S3_BUCKET_NAME / S3_ENDPOINT / USE_S3_STORAGE values
    And the chart documentation calls out that the bucket is shared with datasets

  @unit
  Scenario: Vanilla helm install with no object storage configured surfaces the unconfigured-storage condition diagnostically and renders anyway
    Given app.dataplaneObjectStorage.enabled is false
    And app.dataplaneObjectStorage.localFilesystem.enabled is false
    When the chart templates are rendered
    Then the chart renders without error
    And the helpers template contains a diagnostic message referencing the unconfigured-storage condition so operators reading the chart find the explanation

  @integration
  Scenario: Single-replica helm install can opt into a PVC-backed local-FS storage path
    Given app.dataplaneObjectStorage.localFilesystem.persistentVolume.enabled is true
    And replicaCount is 1
    When the chart renders the deployment
    Then a PVC is bound at LANGWATCH_LOCAL_STORAGE_PATH
    And the chart refuses to render if replicaCount is greater than 1

  # ---------------------------------------------------------------
  # Self-hosting docs (AC36)
  # ---------------------------------------------------------------

  @unit
  Scenario: Self-hosting docs describe scenario media externalization, the LANGWATCH_LOCAL_STORAGE_PATH env, and the shared dataplane bucket
    Given the self-hosting environment-variables docs
    Then they list LANGWATCH_LOCAL_STORAGE_PATH with its default and rationale
    And they explain that the dataplane S3 bucket is shared between datasets and scenario media
    And the architecture diagram includes an app->S3 arrow for stored-objects

  @unit
  Scenario: .env.example carries LANGWATCH_LOCAL_STORAGE_PATH with a sensible local default
    Given the .env.example file at repository root
    Then it contains a LANGWATCH_LOCAL_STORAGE_PATH key
    And the default value works under "make quickstart" without further configuration

  # ---------------------------------------------------------------
  # Cloud provider matrix (AC37)
  # ---------------------------------------------------------------

  @integration
  Scenario: Azure Blob Storage is supported as a stored-objects backend via a distinct URI scheme
    Given an Azure-tenant deployment with Azure Blob configured
    When the service mints a storage URI for a project
    Then the URI uses an azure-blob scheme distinct from s3 and file
    And the storage registry dispatches the URI to an Azure Blob driver
    And both GET and PUT round-trip the same bytes

  # ---------------------------------------------------------------
  # Project-delete cascade (AC38)
  # ---------------------------------------------------------------

  @integration
  Scenario: When a project is deleted, cascadeDeleteProject removes both the stored_objects rows and the underlying bytes
    Given a project with N stored_objects rows across several owners
    When the platform's project-delete handler invokes cascadeDeleteProject for that project
    Then every stored_objects row for the project is deleted from ClickHouse
    And every byte object at the corresponding storage URIs is deleted from the storage backend
    And subsequent GET /api/files/:id for any of those ids returns 404 with status not_found

  # ---------------------------------------------------------------
  # UI playback contract (AC39) — drives onLoadedData/onCanPlay correctness
  # ---------------------------------------------------------------

  @integration
  Scenario: MediaPart audio playback reports a non-zero duration once the browser has decoded the media
    Given a real audio file is stored and referenced by a trace message
    When the trace timeline renders the MediaPart
    Then the audio element fires loadeddata or canplay
    And the player's duration is greater than zero
    And the play button is enabled

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
  # AC23 "Extractor handles MESSAGE_SNAPSHOT and TEXT_MESSAGE_END shapes"    -> Scenario: Extractor handles MESSAGE_SNAPSHOT events with messages[] in addition to TEXT_MESSAGE_END events with single message
  # AC24 "Degraded passthrough on AG-UI parse failure"                       -> Scenario: Content parts that fail AG-UI parse cause the message to pass through unchanged
  # AC25 "Binary part variant in AG-UI content union"                        -> Scenario: Binary part variant with inline data is externalized to id and url
  #                                                                          -> Scenario: Binary part variant rejects parts that carry data plus an explicit id or url
  # AC26 "Compensating storage cleanup on DB insert failure"                 -> Scenario: DB insert failure after a successful storage PUT triggers compensating storage delete
  #                                                                          -> Scenario: ClickHouse insert errors surface synchronously to the caller
  # AC27 "Dual-auth on /api/files/:id (session cookie OR API key)"          -> Scenario: GET /api/files/:id authenticates a browser via session cookie when no API key header is present
  #                                                                          -> Scenario: GET /api/files/:id authenticates via API key header when no session cookie is present
  # AC28 "404 not_found is distinct from 404 missing"                        -> Scenario: GET /api/files/:id returns 404 with status not_found when no row exists for the id
  # AC29 "Cross-tenant id->project resolve runs before auth gate"            -> Scenario: GET /api/files/:id resolves the owning project from the row id before applying the membership check
  # AC30 "BYOC: per-project private bucket beats global S3_BUCKET_NAME"      -> Scenario: For a project with a per-project private dataplane bucket, mintStorageUri uses the project bucket, not the global one
  #                                                                          -> Scenario: For a project without per-project storage configured, mintStorageUri falls back to the global S3_BUCKET_NAME
  # AC31 "Persisted storage_uri is authoritative for reads"                  -> Scenario: storage_uri persisted on the stored_objects row is the authoritative bucket address for reads
  # AC32 "Helm chart emits S3_BUCKET_NAME"                                   -> Scenario: Helm chart emits S3_BUCKET_NAME (not legacy S3_BUCKET) so the app and stored-objects find the bucket
  # AC33 "Helm dataplane object-storage block (datasets + stored-objects)"   -> Scenario: Helm chart exposes a single dataplane object-storage config block covering datasets and stored-objects together
  # AC34 "Helm surfaces unconfigured-storage condition diagnostically"       -> Scenario: Vanilla helm install with no object storage configured surfaces the unconfigured-storage condition diagnostically and renders anyway
  # AC35 "Helm PVC opt-in for single-replica local-FS"                       -> Scenario: Single-replica helm install can opt into a PVC-backed local-FS storage path
  # AC36 "Self-hosting docs cover scenario media + LANGWATCH_LOCAL_STORAGE_PATH" -> Scenario: Self-hosting docs describe scenario media externalization, the LANGWATCH_LOCAL_STORAGE_PATH env, and the shared dataplane bucket
  #                                                                          -> Scenario: .env.example carries LANGWATCH_LOCAL_STORAGE_PATH with a sensible local default
  # AC37 "Azure Blob support (decision required, separate PR OK)"            -> Scenario: Azure Blob Storage is supported as a stored-objects backend via a distinct URI scheme
  # AC38 "Project-delete cascade removes rows AND bytes"                     -> Scenario: When a project is deleted, cascadeDeleteProject removes both the stored_objects rows and the underlying bytes
  # AC39 "MediaPart playback contract (onLoadedData / non-zero duration)"    -> Scenario: MediaPart audio playback reports a non-zero duration once the browser has decoded the media
