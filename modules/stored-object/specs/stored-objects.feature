# See ../adrs/001-package-boundary.md
#
# `@unimplemented` was a file-level tag, which merged into every scenario and
# left the whole file enforcing nothing. It now sits on each scenario that is
# genuinely unbuilt, so a scenario without it is bound to a test that runs.
Feature: Stored Objects service and API
  As a feature or API client
  I want durable project-scoped byte references
  So that bytes can be stored and delivered without exposing provider details

  @architecture @typecheck
  Scenario: Stored Objects lives in one feature package
    Given Stored Objects is installed
    Then @langwatch/stored-object-contract contains portable schemas, errors and RPC contracts
    And @langwatch/stored-object-server contains the concrete store, service, migration and API registration
    And the feature has no web package or separate object-storage package
    And neither package imports the application

  @architecture @typecheck
  Scenario: Stored Objects adopts the strict feature layout
    Given the Stored Objects implementation is reduced to its approved scope
    And its feature.json declares layoutVersion 0
    Then its contract capability is the StoredObjectApi interface and its feature token
    And its server service is services/stored-object.service.ts
    And its canonical row is reached through a repository interface with a Prisma and a memory backend
    And a process selects the backend once, at boot, through the repository registry
    And its public RPC family and its existence probe are flat transport declarations the process mounts
    And its ClickHouse import is migrations/clickhouse-import.stored-object.migration.ts
    And no composition, registration, lifecycle, or eventing source directory remains

  @architecture @persistence
  Scenario: One Postgres row owns current state
    Given Stored Objects persists operational metadata
    Then StoredObject is its only Postgres domain table
    And the row contains tenant, object, status, owner, provider-relative identity, byte facts and expiry timestamps
    And StoredObjectRecordRepository is one interface with a Prisma and a memory backend
    And StoredObjectService is a concrete class
    And no Stored Object event projection, process manager or parallel lifecycle store exists

  @unit @persistence
  Scenario: The memory and Postgres stored-object repositories answer alike
    Given the same rows are written through either backend
    When a reader asks for one row, counts the project's active bytes, or pages the project
    Then both backends answer with the same rows in the same order
    And neither answers with a row another project wrote
    And rewriting a row replaces it rather than adding a second one

  @unit @composition
  Scenario: A process boots the Stored Objects feature over either backend
    Given a process installs the Stored Objects feature and selects a persistence backend
    When it boots in the api, worker or task role
    Then the feature answers as the StoredObjectApi token for that process
    And each installation holds its own rows
    And a read scoped to another project is refused as not found

  @architecture @storage
  Scenario: Stored Objects has one portable storage URI owner
    Given the application composes its existing storage drivers
    Then @langwatch/stored-object-contract owns URI formatting and redaction
    And the existing S3, Azure Blob and local-filesystem drivers remain authoritative
    And application composition owns lazy scheme dispatch
    And validated application configuration retains destination selection and credentials
    And inactive Azure configuration does not block S3 or local-filesystem traffic

  @unimplemented @integration @stored-objects
  Scenario: Internal storage is content addressed
    Given a feature stores bytes through app.storedObjects
    When the same project stores identical bytes again
    Then both calls derive the same stored-object ID from project and SHA-256
    And one available StoredObject row describes the bytes
    And each caller may retain its own presentation metadata

  @unimplemented @integration @public-rpc
  Scenario: A public client creates a direct upload
    Given an authenticated project whose selected storage driver supports direct upload
    When the client calls storedObjects.createUpload with bounded metadata and byte facts
    Then a pending StoredObject row with an expiry is persisted before the response is returned
    And the response contains an opaque upload token and signed provider target
    And provider credentials and relative identity are not returned

  @unimplemented @integration @public-rpc @integrity
  Scenario: A client confirms a direct upload
    Given a client uploaded bytes to its signed target
    When it calls storedObjects.confirmUpload
    Then the service verifies the stored length and SHA-256
    And the same StoredObject row becomes available
    And retrying confirmation returns the same reference
    And absent, expired or mismatched bytes never become available

  @unimplemented @integration @cleanup
  Scenario: Expired pending uploads are cleaned from the same row
    Given a pending upload has passed expiresAt without confirmation
    When the bounded cleanup pass visits it
    Then the service deletes its provider bytes if present
    And the StoredObject row becomes failed
    And retrying cleanup is safe

  @unimplemented @integration @delivery @security
  Scenario: An authorized caller resolves and streams bytes
    Given an available stored object belongs to the authenticated project
    When the caller resolves it or uses its GET or HEAD delivery route
    Then the public RPC authorizes the object's validated audience through the request context
    And metadata comes from Postgres
    And bytes stream through the existing storage adapter
    And the response reveals no provider, credential or filesystem detail
    And an object from another project is not read

  @unimplemented @integration @delete
  Scenario: Deletion immediately revokes delivery
    Given an available stored object
    When its project calls storedObjects.delete
    Then the row becomes deleted before physical cleanup is attempted
    And later delivery is refused
    And failed physical cleanup remains retryable from that same row
    And repeating deletion is safe

  @unimplemented @integration @api @authorization
  Scenario: The public API uses the unified API package
    Given the Stored Objects public API is installed
    Then createUpload and confirmUpload require project:update
    And get requires project:view
    And delete requires project:manage
    And @langwatch/api supplies routing, validation, OpenAPI, telemetry, handled errors and registration
    And rate limiting is declared through the existing endpoint capability

  @unimplemented @integration @trpc
  Scenario: Application tRPC remains separate
    Given the dashboard uses its existing Stored Objects procedure
    When the procedure resolves an object
    Then it delegates to the composed app.storedObjects service
    And it does not expose public upload or migration operations
    And it does not construct a second service

  @unimplemented @integration @delivery @compatibility
  Scenario: Historical id-only delivery resolves the owner without masking degradation
    Given a historical GET or HEAD /api/files/:id URL has no project scope
    When the server-only owner resolver fans out to the configured ClickHouse instances
    Then a healthy matching instance identifies the project before byte authorization
    And a miss across healthy instances remains not found
    And a miss with any failed instance is mapped to the existing 502 response
    And a project-scoped URL does not invoke the cross-tenant resolver

  @unimplemented @integration @migration
  Scenario: The system migration copies legacy ClickHouse rows directly
    Given an organization has stored_objects rows in ClickHouse
    When StoredObjectsMigration runs after being registered with the system migration service
    Then it pages the organization's projects and latest rows
    And it idempotently upserts their existing IDs and storage locations into StoredObject
    And rerunning a completed page creates no duplicate state
    And invalid input parks the tenant with a bounded report
    And Postgres becomes authoritative only after old writers drain and a final pass succeeds

  @unimplemented @integration @migration @startup
  Scenario: Stored Objects startup migration blocks readiness until finalization
    Given a replica has declared the Stored Objects ClickHouse migration in startup mode
    When import or finalization is incomplete
    Then the replica does not construct the Postgres-backed Stored Objects service
    And readiness remains blocked
    And the replica does not accept traffic or consumers

  @unimplemented @integration @migration @startup
  Scenario: Finalization refuses a missing old-writer drain
    Given the latest legacy rows have been copied
    And an old writer is still active or has not been fenced
    When startup migration finalization runs
    Then finalization fails with a bounded migration error
    And the final legacy scan does not authorize cutover
    And readiness remains blocked

  @unimplemented @integration @migration @startup
  Scenario: A failed import leaves startup blocked
    Given a legacy page cannot be imported or validated
    When the startup migration records the failure
    Then the migration remains unfinished
    And Postgres is not made authoritative
    And readiness remains blocked until the durable migration state is completed

  @unimplemented @integration @migration @startup
  Scenario: Another replica observes durable migration completion
    Given one replica has completed the final scan and persisted migration completion
    When another replica starts with the same migration declaration
    Then it observes the durable completion state
    And it may pass readiness only after its startup migration checks succeed
    And it does not run a second migration or serve from a partial import
